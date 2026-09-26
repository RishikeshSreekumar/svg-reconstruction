<script lang="ts">
  import type { Fit, SegRef, Shape } from '../../../src/types.ts';
  import { breakApartShape, cutShape, deleteShape, editSegmentParam, editShapeParam, findCutTarget, reorderShape, segmentFields, shapeBBox, shapeFields } from '../../../src/index.ts';
  import { paramRows } from '../lib/params.ts';
  import { tooltip } from '../lib/tooltip.ts';
  import { store } from '../state/scene.svelte.ts';
  import { view } from '../state/view.svelte.ts';
  import ColorField from './ColorField.svelte';
  import Icon from './Icon.svelte';
  import ParamRow from './ParamRow.svelte';

  let { s }: { s: Shape } = $props();

  const refKey = (r: SegRef): string => `${r.shape}#${r.contour}.${r.seg}`;

  const KIND_LABELS: Record<string, string> = {
    circle: 'Circle',
    ellipse: 'Ellipse',
    rect: 'Rectangle',
    line: 'Line',
    polygon: 'Polygon',
    path: 'Path',
    text: 'Text',
  };

  const rows = $derived((store.rev, paramRows(shapeFields(s), s.kind)));
  const conf = $derived((store.rev, Math.round(s.meta.confidence * 100)));
  const col = $derived(conf >= 85 ? 'var(--good)' : conf >= 60 ? 'var(--warn)' : 'var(--bad)');
  const isSel = $derived(store.selected === s.id);
  const sceneIndex = $derived((store.rev, store.scene?.shapes.findIndex((x) => x.id === s.id) ?? -1));
  const canMoveForward = $derived(sceneIndex >= 0 && sceneIndex < (store.scene?.shapes.length ?? 0) - 1);
  const canMoveBackward = $derived(sceneIndex > 0);
  const cutTargetId = $derived((store.rev, store.scene ? findCutTarget(store.scene, s.id) : null));
  const cutTarget = $derived((store.rev, cutTargetId ? (store.scene?.shapes.find((x) => x.id === cutTargetId) ?? null) : null));
  const cutTargetLabel = $derived(cutTarget ? (KIND_LABELS[cutTarget.kind] ?? cutTarget.kind).toLowerCase() : '');
  const shapeIcon = $derived(s.kind === 'path' ? 'path' : s.kind);
  const shapeLabel = $derived(KIND_LABELS[s.kind] ?? s.kind);
  const segNotes = $derived((store.rev, store.scene?.construction?.segs.filter((n) => n.ref.shape === s.id) ?? []));
  const selSegKey = $derived(store.selectedSeg ? refKey(store.selectedSeg) : null);

  // "fit" is the one number on this card that isn't a coordinate, so it says
  // what it measured rather than leaving a bare percentage to be guessed at.
  const authored = $derived(s.meta.from.length === 0);
  const fitTitle = $derived.by(() => {
    store.rev;
    if (authored) return 'Drawn here, not reconstructed — its geometry is exact by definition.';
    const tol = store.scene?.report.tol;
    const dev = `${s.meta.maxDev.toExponential(2)} user units`;
    return `Fit ${conf}% — this outline strays at most ${dev} from the source${tol ? ` (budget ${tol.toExponential(2)})` : ''}. 100% means it traces the original exactly; a low score means the fit fell back to freehand curves.`;
  });

  let expanded = $state(false);
  let wasSelected = false;

  // Selection drives disclosure both ways: selecting a shape reveals its
  // editor, deselecting collapses it, so the panel always mirrors canvas
  // focus. An already-selected card can still be collapsed by its header.
  $effect(() => {
    if (isSel !== wasSelected) expanded = isSel;
    wasSelected = isSel;
  });

  function fitAt(r: SegRef): Fit | null {
    const shape = store.scene?.shapes.find((x) => x.id === r.shape);
    if (!shape || shape.kind !== 'path') return null;
    return shape.contours[r.contour]?.segs[r.seg] ?? null;
  }

  function editField(key: string, v: number): void {
    store.mutate((sc) => {
      const r = editShapeParam(sc, s.id, key, v, store.editOpts());
      store.warning = r.applied ? '' : 'edit refused: that value is out of range for this shape';
    });
  }

  function editSeg(ref: SegRef, key: string, v: number): void {
    store.mutate((sc) => store.track(editSegmentParam(sc, ref, key, v, store.editOpts())));
  }

  function toggleSeg(ref: SegRef): void {
    const same = selSegKey === refKey(ref);
    store.select(s.id, same ? null : ref);
  }

  // A picker drag streams live values: checkpoint once at the start of the
  // burst, and skip the construction rebuild — colour never changes geometry.
  let styleBurst = false;

  function styleEdit(prop: 'fill' | 'stroke', raw: string, live = false): void {
    const v = raw.trim();
    const commit = !styleBurst;
    styleBurst = live;
    store.mutate(
      (sc) => {
        const t = sc.shapes.find((x) => x.id === s.id);
        if (!t) return;
        t.style[prop] = v === '' || v === 'none' ? null : v;
        if (prop === 'stroke' && t.style.stroke && t.style.strokeWidth == null) t.style.strokeWidth = 1;
      },
      { commit, rebuild: false },
    );
  }

  function textEdit(raw: string): void {
    store.mutate(
      (sc) => {
        const t = sc.shapes.find((x) => x.id === s.id);
        if (t && t.kind === 'text') t.text = raw;
      },
      { commit: true, rebuild: false },
    );
  }

  function anchorEdit(v: string): void {
    store.mutate(
      (sc) => {
        const t = sc.shapes.find((x) => x.id === s.id);
        if (t && t.kind === 'text' && (v === 'start' || v === 'middle' || v === 'end')) t.anchor = v;
      },
      { commit: true, rebuild: false },
    );
  }

  function remove(): void {
    store.mutate((sc) => deleteShape(sc, s.id), { commit: true, rebuild: false });
    if (store.selected === s.id) store.select(null);
  }

  function order(dir: 'forward' | 'backward'): void {
    store.mutate((sc) => reorderShape(sc, s.id, dir), { commit: true, rebuild: false });
  }

  // Contours first, then segments: the same hierarchy breakApartShape applies.
  const breakInto = $derived.by(() => {
    store.rev;
    if (s.kind !== 'path' || s.cutouts?.length) return null;
    if (s.contours.length > 1) return { n: s.contours.length, what: 'contours' };
    const n = s.contours[0]?.segs.length ?? 0;
    return n > 1 ? { n, what: 'segments' } : null;
  });

  function breakApart(): void {
    let ids: string[] = [];
    store.mutate(
      (sc) => {
        const r = breakApartShape(sc, s.id);
        ids = r.ids;
        store.warning = r.applied ? '' : (r.reason ?? 'could not break this shape apart');
      },
      { commit: true, rebuild: false },
    );
    if (ids.length) {
      store.select(ids[0]);
      store.flash(`broken into ${ids.length} shapes — each now edits on its own. ⌘Z rejoins them`);
    }
  }

  // Hovering the subtract button shows the consequence before the click:
  // the target that will receive the hole gets outlined on the canvas.
  let cutPreview = false;

  function previewCut(on: boolean): void {
    if (on && cutTarget) {
      const b = shapeBBox(cutTarget);
      if (!b) return;
      cutPreview = true;
      view.hoverSpec = {
        box: [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0],
        label: `the hole is cut into this ${cutTargetLabel}`,
        at: { x: (b.x0 + b.x1) / 2, y: b.y0 },
      };
    } else if (cutPreview) {
      cutPreview = false;
      view.hoverSpec = null;
    }
  }

  // The card unmounts on subtract (selection moves to the target), so the
  // preview must not outlive it.
  $effect(() => () => previewCut(false));

  function subtract(): void {
    if (!cutTargetId) return;
    const cutterName = shapeLabel.toLowerCase();
    const targetName = cutTargetLabel;
    previewCut(false);
    let targetId: string | undefined;
    store.mutate(
      (sc) => {
        const result = cutShape(sc, s.id, cutTargetId);
        targetId = result.targetId;
        store.warning = result.applied ? '' : (result.reason ?? 'could not subtract that shape');
      },
      { commit: true, rebuild: false },
    );
    if (targetId) {
      store.select(targetId);
      store.flash(`subtracted — the ${cutterName} is now a hole in the ${targetName}. ⌘Z brings it back`);
    }
  }

  function removeLatestCut(): void {
    store.mutate(
      (sc) => {
        const target = sc.shapes.find((x) => x.id === s.id);
        // Same reason as `cutShape`: replace the array, never splice it, or the
        // views holding a shallow clone of this shape never see the change.
        if (target?.cutouts?.length) target.cutouts = target.cutouts.slice(0, -1);
      },
      { commit: true, rebuild: false },
    );
    store.flash('hole removed — the shape that cut it is not restored, undo does that');
  }
</script>

<div class="shape" class:sel={isSel} data-card={s.id}>
  <h3>
    <button
      class="bare shape-toggle"
      aria-expanded={expanded}
      aria-controls="shape-body-{s.id}"
      onclick={() => {
        if (!isSel) {
          store.select(s.id);
          expanded = true;
        } else {
          expanded = !expanded;
        }
      }}
    >
      <span class="shape-chev" class:open={expanded}><Icon name="chevron" size={11} /></span>
      <span class="kind"><Icon name={shapeIcon} size={15} /></span>
      <span class="shape-name">{shapeLabel}</span>
      <span class="conf" style:color={authored ? 'var(--dim)' : col} use:tooltip={fitTitle}>
        {authored ? 'drawn' : `fit ${conf}%`}
      </span>
    </button>
    <span class="tools">
      <button class="mini" disabled={!canMoveForward} use:tooltip={'Bring forward'} aria-label={`Bring ${shapeLabel} forward`} onclick={() => order('forward')}><Icon name="up" size={12} /></button>
      <button class="mini" disabled={!canMoveBackward} use:tooltip={'Send backward'} aria-label={`Send ${shapeLabel} backward`} onclick={() => order('backward')}><Icon name="down" size={12} /></button>
      <button class="mini danger" use:tooltip={'Delete shape'} aria-label={`Delete ${shapeLabel}`} onclick={remove}><Icon name="trash" size={12} /></button>
    </span>
  </h3>
  {#if expanded}
    <div class="shape-body" id="shape-body-{s.id}">
      {#if s.kind === 'text'}
        <div class="property-group">
          <div class="property-title">Text</div>
          <div class="params">
            <label class="plabel" for="text-{s.id}">Content</label>
            <div class="pfields wide"><div class="pfield"><input id="text-{s.id}" class="text" value={s.text} oninput={(e) => textEdit((e.target as HTMLInputElement).value)} /></div></div>
            <label class="plabel" for="anchor-{s.id}">Alignment</label>
            <div class="pfields wide"><div class="pfield">
              <select id="anchor-{s.id}" value={s.anchor} onchange={(e) => anchorEdit((e.target as HTMLSelectElement).value)}>
                <option value="start">Left</option>
                <option value="middle">Center</option>
                <option value="end">Right</option>
              </select>
            </div></div>
          </div>
        </div>
      {/if}

      {#if rows.length}
        <div class="property-group">
          <div class="property-title">Geometry</div>
          <div class="params">
            {#each rows as r (r.label)}
              <ParamRow label={r.label} fields={r.fields} onchange={editField} />
            {/each}
          </div>
        </div>
      {/if}

      <div class="property-group">
        <div class="property-title">Appearance</div>
        <div class="params">
          <label class="plabel" for="fill-{s.id}">Fill</label>
          <div class="pfields wide"><div class="pfield"><ColorField id="fill-{s.id}" label="Fill color" value={s.style.fill} onchange={(value, live) => styleEdit('fill', value, live)} /></div></div>
          <label class="plabel" for="stroke-{s.id}">Outline</label>
          <div class="pfields wide"><div class="pfield"><ColorField id="stroke-{s.id}" label="Outline color" value={s.style.stroke} onchange={(value, live) => styleEdit('stroke', value, live)} /></div></div>
        </div>
      </div>

      {#if breakInto}
        <div class="property-group">
          <div class="property-title">Structure</div>
          <button class="cut-action" onclick={breakApart}>
            <Icon name="ungroup" size={14} />
            <span>Break apart into {breakInto.n} {breakInto.what}</span>
          </button>
          <div class="action-note">
            {#if breakInto.what === 'contours'}
              Each contour of this path becomes its own shape, editable on its own. Undo (⌘Z) rejoins them.
            {:else}
              Each segment becomes its own shape — an arc becomes a free arc, a line a free line — no longer
              tied to its neighbours by the join solver. Undo (⌘Z) rejoins them.
            {/if}
          </div>
        </div>
      {/if}

      {#if cutTargetId}
        <div class="property-group">
          <div class="property-title">Boolean</div>
          <button
            class="cut-action"
            onpointerenter={() => previewCut(true)}
            onpointerleave={() => previewCut(false)}
            onfocus={() => previewCut(true)}
            onblur={() => previewCut(false)}
            onclick={subtract}
          >
            <Icon name="cut" size={14} />
            <span>Subtract from the {cutTargetLabel} below</span>
          </button>
          <div class="action-note">
            Cuts this {shapeLabel.toLowerCase()}'s outline out of the {cutTargetLabel} behind it, leaving a hole, and removes the cutter.
            Undo (⌘Z) restores it. Hover the button to see which shape takes the hole.
          </div>
        </div>
      {/if}

      {#if s.cutouts?.length}
        <div class="property-group">
          <div class="property-title">Holes</div>
          <div class="cutrow">
            <span>{s.cutouts.length} {s.cutouts.length === 1 ? 'hole' : 'holes'} cut from this shape</span>
            <button onclick={removeLatestCut}>Remove last</button>
          </div>
          <div class="action-note">Removing a hole only fills it in — the shape that cut it stays gone. Undo (⌘Z) brings both back.</div>
        </div>
      {/if}

      {#if s.meta.note}<div class="note">{s.meta.note}</div>{/if}

      {#if s.kind === 'path' && segNotes.length}
        <div class="property-group segments-group">
          <div class="property-title">Segments <span>{segNotes.length}</span></div>
          <div class="segs">
            <span class="h i">#</span><span class="h">Type</span><span class="h">Measurement</span><span class="h j">Join</span>
            {#each segNotes as n (refKey(n.ref))}
              {@const key = refKey(n.ref)}
              {@const open = selSegKey === key}
              <button class="bare i" class:on={open} aria-label="Edit segment {n.ref.seg}" onclick={() => toggleSeg(n.ref)}>{n.ref.seg}</button>
              <button class="bare k" class:on={open} onclick={() => toggleSeg(n.ref)}>{n.kind}</button>
              <button class="bare v" class:on={open} onclick={() => toggleSeg(n.ref)}>{n.value}</button>
              <button class="bare j" class:on={open} onclick={() => toggleSeg(n.ref)}>{n.relation}</button>
              {#if open}
                {@const f = fitAt(n.ref)}
                {#if f}
                  <div class="segparams">
                    <div class="params">
                      {#each paramRows(segmentFields(f)) as r (r.label)}
                        <ParamRow label={r.label} fields={r.fields} onchange={(k, v) => editSeg(n.ref, k, v)} />
                      {/each}
                    </div>
                    <!-- Refusals land next to the field that caused them. -->
                    {#if store.warning}<div class="segwarn" role="status">{store.warning}</div>{/if}
                  </div>
                {/if}
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
