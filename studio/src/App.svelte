<script lang="ts">
  import { deleteShape, translateShapeInScene } from '../../src/index.ts';
  import { store } from './state/scene.svelte.ts';
  import { tools, TOOLS } from './state/tools.svelte.ts';
  import { loadSample, loadSVG, looksLikeSVG, sampleNames } from './lib/svg-load.ts';
  import { view } from './state/view.svelte.ts';
  import Toolbar from './components/Toolbar.svelte';
  import ToolRail from './components/ToolRail.svelte';
  import CanvasStage from './components/CanvasStage.svelte';
  import OriginalThumb from './components/OriginalThumb.svelte';
  import SpecPanel from './components/SpecPanel.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import OpenModal from './components/OpenModal.svelte';

  let openOpen = $state(false);
  let dropOn = $state(false);

  // Start with something on the canvas.
  $effect(() => {
    if (!store.scene && sampleNames.length) {
      loadSample(sampleNames.find((n) => n.includes('14-logo')) ?? sampleNames[0]);
    }
  });

  const inField = (t: EventTarget | null): boolean =>
    t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);

  // Arrow-key nudge: one undo checkpoint per burst of presses.
  let nudgeFresh = true;
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;

  function nudge(dx: number, dy: number, big: boolean): void {
    const s = store.scene;
    const id = store.selected;
    if (!s || !id) return;
    const step = (Math.max(s.viewBox[2], s.viewBox[3]) / 400) * (big ? 10 : 1);
    if (nudgeFresh) {
      store.checkpoint();
      nudgeFresh = false;
    }
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => (nudgeFresh = true), 600);
    store.mutate((sc) => translateShapeInScene(sc, id, dx * step, dy * step, store.editOpts()));
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // Staged escape: modal, then segment, then shape, then tool — one level per press.
      if (openOpen) openOpen = false;
      else if (store.selectedSeg) store.select(store.selected);
      else if (store.selected) store.select(null);
      else tools.set('select');
      return;
    }
    if (inField(e.target)) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (e.key === ' ') {
      tools.spaceHeld = true;
      e.preventDefault();
      return;
    }
    if (e.key === '0' && !meta && store.scene) {
      view.fit(store.scene);
      return;
    }
    if (e.key.startsWith('Arrow') && store.selected && !meta) {
      e.preventDefault();
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) nudge(d[0], d[1], e.shiftKey);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && store.selected) {
      const id = store.selected;
      store.mutate((s) => deleteShape(s, id), { commit: true, rebuild: false });
      store.select(null);
      return;
    }
    if (!meta) {
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) tools.set(t.id);
    }
  }

  function onkeyup(e: KeyboardEvent): void {
    if (e.key === ' ') tools.spaceHeld = false;
  }

  function onpaste(e: ClipboardEvent): void {
    if (openOpen || inField(e.target)) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (looksLikeSVG(text)) {
      e.preventDefault();
      void loadSVG(text);
    }
  }

  function ondragover(e: DragEvent): void {
    // Only file drags get the drop overlay — internal text/element drags don't.
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dropOn = true;
  }

  function ondrop(e: DragEvent): void {
    e.preventDefault();
    dropOn = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type && !file.type.includes('svg') && !file.name.toLowerCase().endsWith('.svg')) {
      store.warning = `that file is ${file.type} — drop an SVG`;
      return;
    }
    file.text().then((t) => loadSVG(t));
  }

  // Refuse to lose edits to a stray tab close or refresh.
  function onbeforeunload(e: BeforeUnloadEvent): void {
    if (store.dirty) e.preventDefault();
  }

  // Drag the divider between canvas and spec panel to resize the panel.
  function startPanelResize(down: PointerEvent): void {
    down.preventDefault();
    const startX = down.clientX;
    const startW = view.panelW;
    const el = down.currentTarget as HTMLElement;
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent): void => {
      view.panelW = Math.min(560, Math.max(240, startW + (startX - e.clientX)));
    };
    const up = (): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }
</script>

<svelte:window {onkeydown} {onkeyup} {onpaste} {ondragover} {ondrop} {onbeforeunload} ondragleave={() => (dropOn = false)} />

<div class="app" class:busy={store.busy}>
  <Toolbar onopen={() => (openOpen = true)} />
  <div class="main" style:grid-template-columns="auto 1fr 5px {view.panelW}px">
    <ToolRail />
    <div class="canvas-wrap">
      <CanvasStage />
      <OriginalThumb />
    </div>
    <!-- A focusable window splitter is the ARIA pattern: separator + tabindex + arrow keys. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="resizer"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={240}
      aria-valuemax={560}
      aria-valuenow={view.panelW}
      onpointerdown={startPanelResize}
      onkeydown={(e) => {
        if (e.key === 'ArrowLeft') view.panelW = Math.min(560, view.panelW + 16);
        else if (e.key === 'ArrowRight') view.panelW = Math.max(240, view.panelW - 16);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    ></div>
    <SpecPanel />
  </div>
  <StatusBar />
</div>

{#if openOpen}
  <OpenModal onclose={() => (openOpen = false)} />
{/if}

<div class="drop" class:on={dropOn}>drop an SVG</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .app.busy {
    cursor: progress;
  }
  .main {
    flex: 1;
    display: grid;
    min-height: 0;
    background: var(--bg);
  }
  .canvas-wrap {
    position: relative;
    background: var(--canvas);
    min-width: 0;
    overflow: hidden;
  }
  .resizer {
    cursor: col-resize;
    background: var(--line);
    touch-action: none;
    transition: background 0.12s ease;
  }
  .resizer:hover,
  .resizer:active {
    background: var(--primary);
  }
  .drop {
    position: fixed;
    inset: 0;
    background: rgba(79, 70, 229, 0.08);
    border: 2px dashed var(--primary);
    display: none;
    place-items: center;
    color: var(--primary);
    font-size: 16px;
    font-weight: 500;
    z-index: 30;
    pointer-events: none;
  }
  .drop.on {
    display: grid;
  }
</style>
