<script lang="ts">
  import type { Pt, Shape } from '../../../src/types.ts';
  import { createShape, editShapeParams, nextUserGuideId, shapeAnchor, sizeCurve, translateShapeInScene, type CreatableKind } from '../../../src/index.ts';
  import { store } from '../state/scene.svelte.ts';
  import { view } from '../state/view.svelte.ts';
  import { tools } from '../state/tools.svelte.ts';
  import { userPt } from '../lib/coords.ts';
  import { shapeHandles, type Handle } from '../lib/handles.ts';
  import { describeSnap, gridStepFor, snapPoint } from '../lib/snap.ts';
  import GridLayer from './GridLayer.svelte';
  import ShapeView from './ShapeView.svelte';
  import GuidelinesLayer from './GuidelinesLayer.svelte';
  import HandlesLayer from './HandlesLayer.svelte';
  import SpecHighlightLayer from './SpecHighlightLayer.svelte';

  let stageEl: HTMLDivElement | undefined = $state();
  let boardEl: HTMLDivElement | undefined = $state();
  let svgEl: SVGSVGElement | undefined = $state();
  let stageW = $state(0);
  let stageH = $state(0);

  // Shallow clones, refreshed per rev: the engine mutates the scene in place,
  // so identical references would make Svelte skip every downstream update.
  const scene = $derived.by(() => {
    store.rev;
    return store.scene ? { ...store.scene } : null;
  });
  const shapes = $derived.by(() => {
    store.rev;
    return (store.scene?.shapes ?? []).map((s) => ({ ...s }) as Shape);
  });
  const segKey = $derived(store.selectedSeg ? `${store.selectedSeg.shape}#${store.selectedSeg.contour}.${store.selectedSeg.seg}` : null);

  const vb = $derived(scene ? view.viewBoxOf(scene) : ([0, 0, 100, 100] as [number, number, number, number]));
  const vbStr = $derived(vb.join(' '));

  const PAD = 28;
  const board = $derived.by(() => {
    if (!scene || stageW < 10 || stageH < 10) return { w: 0, h: 0 };
    const aspect = vb[2] / vb[3] || 1;
    const availW = stageW - 2 * PAD;
    const availH = stageH - 2 * PAD;
    const w = Math.min(availW, availH * aspect);
    return { w, h: w / aspect };
  });
  /** One screen pixel in user units, from geometry — no CTM reads in deriveds. */
  const unit = $derived(board.w > 0 ? vb[2] / board.w : 1);
  const gridStep = $derived(gridStepFor(1 / unit));

  const origHref = $derived(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(store.inputSVG)}`);

  const handles: Handle[] = $derived.by(() => {
    store.rev;
    const s = store.scene;
    if (!s || !store.selected) return [];
    const shape = s.shapes.find((x) => x.id === store.selected);
    if (!shape) return [];
    return shapeHandles(s, shape, store.editOpts(), (r) => store.track(r));
  });

  // In-canvas refusal note: anchored where the refused handle sits, so the
  // explanation lands where the user is looking, not only in the status bar.
  let warnAtTimer: ReturnType<typeof setTimeout> | undefined;

  function flagRefusal(at: Pt): void {
    view.warnAt = { x: at.x, y: at.y };
    clearTimeout(warnAtTimer);
    warnAtTimer = setTimeout(() => (view.warnAt = null), 2600);
  }

  /** Word-wrap the warning for SVG tspans (~34 chars per line, max 3 lines). */
  const warnLines = $derived.by(() => {
    if (!store.warning) return [];
    const words = store.warning.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > 34) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  });
  const warnAnchor = $derived(view.warnAt && view.warnAt.x > vb[0] + vb[2] * 0.55 ? 'end' : 'start');

  // ------------------------------------------------------------------- drag

  type Drag =
    | { t: 'handle'; handle: Handle }
    | { t: 'body'; id: string; start: Pt; anchor0: Pt }
    | { t: 'guide'; id: string }
    | { t: 'guide-angle'; id: string; anchor: Pt }
    | { t: 'size'; id: string; kind: CreatableKind; anchor: Pt }
    | { t: 'pan'; startClient: Pt; startC: Pt };
  let drag: Drag | null = null;

  // A click is not an edit: the undo checkpoint is taken lazily on the first
  // mutation of the gesture, so selecting a shape or grabbing a handle without
  // moving it never pushes history (or clears the redo stack).
  let needCommit = false;

  function commitOnce(): void {
    if (!needCommit) return;
    needCommit = false;
    store.checkpoint();
  }

  // Hover feedback: which shape is under the cursor, and which handle is in reach.
  let hoverId: string | null = $state(null);
  let hotHandle: number | null = $state(null);

  /** Index of the nearest handle within grab reach, or null. */
  function nearestHandle(p: Pt): number | null {
    const reach = 9 * unit;
    let best: number | null = null;
    let bestD = reach;
    handles.forEach((h, i) => {
      const d = Math.hypot(h.at.x - p.x, h.at.y - p.y);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  /**
   * Snap a point to the grid and guidelines. While editing a shape, guides
   * derived from that same shape (and the ink bbox, which it may define) are
   * excluded — they re-derive after every mutation, so they would chase the
   * handle and ratchet the drag back every frame.
   */
  function snap(p: Pt, ev: PointerEvent, o: { guides?: boolean; exclude?: string } = {}): Pt {
    const s = store.scene;
    if (!s) return p;
    let gl = o.guides === false || !view.showGuides || !view.snap ? [] : (s.guidelines ?? []);
    if (o.exclude) gl = gl.filter((g) => g.role !== 'bbox' && !g.from?.includes(o.exclude!));
    const res = snapPoint(p, {
      gridStep: view.showGrid && view.snap ? gridStep : undefined,
      guidelines: gl,
      tol: 6 * unit,
      bypass: ev.altKey,
    });
    view.snapHint = describeSnap(res.hits);
    return res.p;
  }

  function onpointerdown(ev: PointerEvent): void {
    if (!scene || !svgEl || ev.button !== 0) return;
    const p = userPt(ev, svgEl);
    if (!p) return;
    if (!Number.isFinite(view.cx)) view.fit(scene);
    view.warnAt = null;
    stageEl?.setPointerCapture(ev.pointerId);
    const tool = tools.effective;

    if (tool === 'pan') {
      drag = { t: 'pan', startClient: { x: ev.clientX, y: ev.clientY }, startC: { x: view.cx, y: view.cy } };
      return;
    }

    if (tool === 'select') {
      // Handles first, then user guides, then shape bodies, then empty space.
      const hi = nearestHandle(p);
      if (hi != null) {
        ev.preventDefault();
        needCommit = true;
        drag = { t: 'handle', handle: handles[hi] };
        view.compare = false;
        return;
      }
      const guideEl = (ev.target as Element).closest?.('[data-guide-id]');
      const guideId = guideEl?.getAttribute('data-guide-id');
      if (guideId) {
        needCommit = true;
        drag = { t: 'guide', id: guideId };
        return;
      }
      const shapeEl = (ev.target as Element).closest?.('[data-shape-id]');
      const shapeId = shapeEl?.getAttribute('data-shape-id');
      if (shapeId) {
        if (store.selected !== shapeId) store.select(shapeId);
        view.compare = false;
        needCommit = true;
        const target = scene.shapes.find((x) => x.id === shapeId);
        drag = { t: 'body', id: shapeId, start: p, anchor0: target ? shapeAnchor(target) : p };
        return;
      }
      store.select(null);
      return;
    }

    if (tool === 'guide-h' || tool === 'guide-v' || tool === 'guide-angle') {
      const sp = snap(p, ev);
      let guideId = '';
      store.mutate(
        (s) => {
          guideId = nextUserGuideId(s);
          (s.guidelines ??= []).push(
            tool === 'guide-h'
              ? { id: guideId, source: 'user', role: 'align', kind: 'h', y: sp.y }
              : tool === 'guide-v'
                ? { id: guideId, source: 'user', role: 'align', kind: 'v', x: sp.x }
                : { id: guideId, source: 'user', role: 'align', kind: 'angled', p: { ...sp }, dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 } },
          );
        },
        { commit: true, rebuild: false },
      );
      if (tool === 'guide-angle') drag = { t: 'guide-angle', id: guideId, anchor: sp };
      else tools.set('select'); // one guide per invocation, same as the shape tools
      return;
    }

    // Shape tools: place at the click, then drag to size until pointerup.
    const kind = tool as CreatableKind;
    const sp = snap(p, ev);
    let createdId = '';
    store.mutate(
      (s) => {
        createdId = createShape(s, kind, sp).id;
      },
      { commit: true },
    );
    store.select(createdId);
    view.compare = false;
    if (kind === 'text') {
      tools.set('select');
      return;
    }
    drag = { t: 'size', id: createdId, kind, anchor: sp };
  }

  function onpointermove(ev: PointerEvent): void {
    if (!scene || !svgEl) return;
    if (!drag) {
      if (view.compare && boardEl) {
        const r = boardEl.getBoundingClientRect();
        view.comparePos = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100));
      }
      // Idle hover: light up the shape and the handle the next click would grab.
      if (tools.effective === 'select') {
        const p0 = userPt(ev, svgEl);
        hotHandle = p0 ? nearestHandle(p0) : null;
        hoverId = (ev.target as Element).closest?.('[data-shape-id]')?.getAttribute('data-shape-id') ?? null;
      } else {
        hotHandle = null;
        hoverId = null;
      }
      return;
    }
    const p = userPt(ev, svgEl);
    if (!p) return;
    const d = drag;

    if (d.t === 'pan') {
      view.cx = d.startC.x - (ev.clientX - d.startClient.x) * unit;
      view.cy = d.startC.y - (ev.clientY - d.startClient.y) * unit;
      return;
    }
    if (d.t === 'handle') {
      const sp = snap(p, ev, { exclude: d.handle.shape });
      commitOnce();
      store.mutate(() => d.handle.apply(sp));
      if (store.warning) flagRefusal(d.handle.at);
      // The scene was re-solved; keep dragging the same conceptual handle.
      const again = handles.find((h) => h.shape === d.handle.shape && h.hint === d.handle.hint);
      if (again) d.handle = again;
      return;
    }
    if (d.t === 'body') {
      const s = store.scene!;
      const shape = s.shapes.find((x) => x.id === d.id);
      if (!shape) return;
      // Absolute delta from the gesture start — per-event deltas would let the
      // snap swallow every small step and pin the shape to whatever it last hit.
      const want = { x: d.anchor0.x + (p.x - d.start.x), y: d.anchor0.y + (p.y - d.start.y) };
      const sp = snap(want, ev, { exclude: d.id });
      const a = shapeAnchor(shape);
      if (sp.x !== a.x || sp.y !== a.y) {
        commitOnce();
        store.mutate(() => translateShapeInScene(s, d.id, sp.x - a.x, sp.y - a.y, store.editOpts()));
      }
      return;
    }
    if (d.t === 'guide') {
      const sp = snap(p, ev, { guides: false }); // grid only: a guide must not snap to itself
      commitOnce();
      store.mutate(
        (s) => {
          const g = s.guidelines?.find((x) => x.id === d.id);
          if (!g) return;
          if (g.kind === 'h') g.y = sp.y;
          else if (g.kind === 'v') g.x = sp.x;
          else if (g.kind === 'angled') g.p = { ...sp };
        },
        { rebuild: false },
      );
      return;
    }
    if (d.t === 'guide-angle') {
      const sp = snap(p, ev, { guides: false });
      const dx = sp.x - d.anchor.x;
      const dy = sp.y - d.anchor.y;
      const len = Math.hypot(dx, dy);
      if (len > unit * 2) {
        store.mutate(
          (s) => {
            const g = s.guidelines?.find((x) => x.id === d.id);
            if (g?.kind === 'angled') g.dir = { x: dx / len, y: dy / len };
          },
          { rebuild: false },
        );
      }
      return;
    }
    if (d.t === 'size') {
      const sp = snap(p, ev, { exclude: d.id });
      const a = d.anchor;
      const rr = Math.max(Math.hypot(sp.x - a.x, sp.y - a.y), unit);
      store.mutate((s) => {
        switch (d.kind) {
          case 'circle':
            editShapeParams(s, d.id, { r: rr }, store.editOpts());
            break;
          case 'polygon':
            editShapeParams(s, d.id, { r: rr }, store.editOpts());
            break;
          case 'ellipse':
            editShapeParams(s, d.id, { rx: Math.max(Math.abs(sp.x - a.x), unit), ry: Math.max(Math.abs(sp.y - a.y), unit) }, store.editOpts());
            break;
          case 'rect':
            editShapeParams(
              s,
              d.id,
              {
                x: Math.min(a.x, sp.x),
                y: Math.min(a.y, sp.y),
                w: Math.max(Math.abs(sp.x - a.x), unit),
                h: Math.max(Math.abs(sp.y - a.y), unit),
              },
              store.editOpts(),
            );
            break;
          case 'line':
            editShapeParams(s, d.id, { 'a.x': a.x, 'a.y': a.y, 'b.x': sp.x, 'b.y': sp.y }, store.editOpts());
            break;
          case 'curve':
            sizeCurve(s, d.id, a, sp);
            break;
          case 'text':
            break;
        }
      });
      return;
    }
  }

  function onpointerup(): void {
    if (drag?.t === 'size' || drag?.t === 'guide-angle') tools.set('select');
    drag = null;
    needCommit = false;
    view.snapHint = '';
  }

  function onpointerleave(): void {
    if (!drag) {
      view.comparePos = 100;
      view.snapHint = '';
      hoverId = null;
      hotHandle = null;
    }
  }

  function ondblclick(ev: MouseEvent): void {
    // Double-click on empty canvas: the way back after any zoom/pan.
    if (!scene) return;
    if ((ev.target as Element).closest?.('[data-shape-id],[data-guide-id]')) return;
    view.fit(scene);
  }

  function onwheel(ev: WheelEvent): void {
    if (!scene || !svgEl) return;
    ev.preventDefault();
    if (!Number.isFinite(view.cx)) view.fit(scene);
    const at = userPt(ev as unknown as PointerEvent, svgEl) ?? undefined;
    view.zoomAt(scene, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), at);
  }
</script>

<div
  bind:this={stageEl}
  bind:clientWidth={stageW}
  bind:clientHeight={stageH}
  role="application"
  aria-label="Canvas"
  class="stage tool-{tools.effective}"
  class:handle-hot={hotHandle != null}
  class:shape-hot={hoverId != null && hotHandle == null}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {onpointerleave}
  {onwheel}
  {ondblclick}
>
  {#if scene}
    <div class="board" bind:this={boardEl} style:width="{board.w}px" style:height="{board.h}px">
      <div class="layer orig" aria-hidden="true">
        <svg viewBox={vbStr} width="100%" height="100%">
          <image
            x={scene.viewBox[0]}
            y={scene.viewBox[1]}
            width={scene.viewBox[2]}
            height={scene.viewBox[3]}
            href={origHref}
            preserveAspectRatio="none"
          />
        </svg>
      </div>
      <div class="layer recon" style:clip-path={view.compare ? `inset(0 ${100 - view.comparePos}% 0 0)` : 'none'}>
        <svg bind:this={svgEl} viewBox={vbStr} width="100%" height="100%">
          {#if view.showGrid}
            <GridLayer viewBox={vb} step={gridStep} {unit} />
          {/if}
          {#each shapes as s (s.id)}
            <ShapeView {s} hitPad={10 * unit} {unit} viewBox={vb} selected={store.selected === s.id} hovered={hoverId === s.id && store.selected !== s.id} />
          {/each}
          {#if view.showGuides}
            <GuidelinesLayer {scene} viewBox={vb} {unit} selected={store.selected} selectedSegKey={segKey} />
          {/if}
          <HandlesLayer {handles} {unit} hot={hotHandle} />
          {#if view.hoverSpec}
            <SpecHighlightLayer hl={view.hoverSpec} viewBox={vb} {unit} />
          {/if}
          {#if view.warnAt && warnLines.length}
            <g pointer-events="none">
              <text
                x={view.warnAt.x + (warnAnchor === 'end' ? -10 : 10) * unit}
                y={view.warnAt.y + 20 * unit}
                font-size={11 * unit}
                text-anchor={warnAnchor}
                fill="var(--mark-amber)"
                stroke="rgba(255, 255, 255, 0.92)"
                stroke-width={3 * unit}
                paint-order="stroke"
                style="font-family: ui-sans-serif, sans-serif"
                >{#each warnLines as l, i (i)}<tspan
                    x={view.warnAt.x + (warnAnchor === 'end' ? -10 : 10) * unit}
                    dy={i ? 13 * unit : 0}>{l}</tspan
                  >{/each}</text
              >
            </g>
          {/if}
        </svg>
      </div>
      {#if view.compare}
        <div class="divider" style:left="{view.comparePos}%">
          <span class="tick l">reconstruction</span>
          <span class="tick r">original</span>
        </div>
      {/if}
    </div>
  {:else}
    <div class="empty">
      <strong>Nothing loaded</strong>
      <span>Use <b>Open new</b> above — or drop an SVG anywhere on the app.</span>
    </div>
  {/if}
</div>

<style>
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  .stage.tool-pan {
    cursor: grab;
  }
  .stage.tool-select.shape-hot {
    cursor: move;
  }
  .stage.tool-select.handle-hot {
    cursor: crosshair;
  }
  .stage.tool-circle,
  .stage.tool-ellipse,
  .stage.tool-rect,
  .stage.tool-line,
  .stage.tool-polygon,
  .stage.tool-curve,
  .stage.tool-text,
  .stage.tool-guide-h,
  .stage.tool-guide-v,
  .stage.tool-guide-angle {
    cursor: crosshair;
  }
  .board {
    position: relative;
    border-radius: 6px;
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow);
  }
  .layer {
    position: absolute;
    inset: 0;
    background: #fff;
    border-radius: 6px;
  }
  .layer.orig {
    pointer-events: none;
  }
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1.5px solid var(--primary);
    pointer-events: none;
  }
  .tick {
    position: absolute;
    top: 8px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: #fff;
    background: var(--primary);
    padding: 2px 7px;
    border-radius: 4px;
    white-space: nowrap;
  }
  .tick.l {
    right: 7px;
  }
  .tick.r {
    left: 7px;
    background: var(--accent);
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: 4px;
    color: var(--dim);
    font-size: 12px;
    text-align: center;
  }
  .empty strong {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .empty b {
    color: var(--primary);
    font-weight: 500;
  }
</style>
