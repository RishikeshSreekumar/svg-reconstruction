<script lang="ts">
  import { countCoords, sceneToSVG } from '../../../src/index.ts';
  import { store } from '../state/scene.svelte.ts';
  import { view } from '../state/view.svelte.ts';
  import { tools, TOOLS } from '../state/tools.svelte.ts';
  import { tooltip } from '../lib/tooltip.ts';
  import Icon from './Icon.svelte';

  const toolLabel = $derived(TOOLS.find((t) => t.id === tools.effective)?.label ?? '');
  // Serializing the scene per rev would run on every drag frame; the count is
  // informational, so it recomputes debounced instead.
  let outStat = $state(0);
  let statTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    store.rev;
    const s = store.scene;
    clearTimeout(statTimer);
    statTimer = setTimeout(() => (outStat = s ? countCoords(sceneToSVG(s)) : 0), 200);
    return () => clearTimeout(statTimer);
  });
  const inStat = $derived(store.inputSVG ? countCoords(store.inputSVG) : 0);
  const drop = $derived(inStat && outStat ? Math.round((1 - outStat / inStat) * 100) : 0);
  const selectedShape = $derived.by(() => {
    store.rev;
    return store.scene?.shapes.find((s) => s.id === store.selected) ?? null;
  });
</script>

<footer class="status">
  <span class="tool">{toolLabel}</span>
  {#if selectedShape}
    <span class="sel" use:tooltip={`${selectedShape.kind} selected`}>
      <Icon name={selectedShape.kind === 'path' ? 'path' : selectedShape.kind} size={12} />
      {#if store.selectedSeg}<span>segment {store.selectedSeg.seg}</span>{/if}
    </span>
  {/if}
  {#if view.snapHint}<span class="snap">{view.snapHint}</span>{/if}
  {#if view.compare}<span class="hint">hover the canvas to wipe reconstruction ↔ original</span>{/if}
  <!-- One polite live region: solver refusals, load errors, and reassurance all announce. -->
  <span class="live" aria-live="polite">
    {#if store.busy}<span class="busywait">reconstructing…</span>
    {:else if store.warning}<span class="warn">{store.warning}</span>
    {:else if store.notice}<span class="notice">{store.notice}</span>{/if}
  </span>
  <span class="gap"></span>
  {#if inStat}
    <span class="counts" use:tooltip={'Coordinate numbers in the input versus the reconstruction'}>
      {inStat} <span class="arrow">→</span>
      {outStat}
      {#if drop > 0}<span class="delta">−{drop}%</span>{/if}
    </span>
  {/if}
  <button class="zoombtn" use:tooltip={'Fit to view (0, or double-click empty canvas)'} aria-label="Fit to view" onclick={() => store.scene && view.fit(store.scene)}
    >{Math.round(view.zoom * 100)}%</button
  >
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 5px 12px;
    border-top: 1px solid var(--line);
    background: var(--bg);
    font-size: 11px;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
    min-height: 27px;
  }
  .tool {
    color: var(--primary);
    background: var(--primary-soft);
    border-radius: 4px;
    padding: 1px 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 10px;
    font-weight: 600;
  }
  .sel {
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .snap {
    color: var(--secondary);
  }
  .hint {
    color: var(--faint);
  }
  .warn {
    color: var(--warn);
  }
  .notice {
    color: var(--good);
  }
  .busywait {
    color: var(--primary);
  }
  .counts .arrow {
    color: var(--faint);
    padding: 0 1px;
  }
  .counts .delta {
    color: var(--secondary);
    background: var(--secondary-soft);
    border-radius: 4px;
    padding: 1px 5px;
    margin-left: 4px;
    font-weight: 500;
  }
  .zoombtn {
    background: none;
    border: none;
    border-radius: 4px;
    padding: 1px 5px;
    color: inherit;
    font: inherit;
    box-shadow: none;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .zoombtn:hover {
    color: var(--text);
    background: var(--panel2);
    border-color: transparent;
  }
  .gap {
    flex: 1;
  }
</style>
