<script lang="ts">
  import { bboxOf, bboxDiag, cloudOf, countCoords, flattenSVG, hausdorff, reconstructSVG, sceneToSVG } from '../../../src/index.ts';
  import { store } from '../state/scene.svelte.ts';
  import { loadSVG } from '../lib/svg-load.ts';
  import Icon from './Icon.svelte';

  let { onopen }: { onopen: () => void } = $props();

  /**
   * Verify by regenerating, at the proof moment: reconstruct the exported file
   * again and measure the round-trip deviation between the two renderings,
   * relative to the artwork diagonal. The number ships inside the file.
   */
  function roundTrip(svg: string): number | null {
    try {
      const again = sceneToSVG(reconstructSVG(svg));
      const a = cloudOf(flattenSVG(svg));
      const b = cloudOf(flattenSVG(again));
      if (!a.length || !b.length) return null;
      return hausdorff(a, b) / bboxDiag(bboxOf(a));
    } catch {
      return null;
    }
  }

  function exportSVG(): void {
    if (!store.scene) return;
    let svg = sceneToSVG(store.scene, { annotate: true });
    const dev = roundTrip(svg);
    if (dev != null) {
      svg = svg.replace(/<\/svg>\s*$/, `<!-- svgrec round-trip: max deviation ${dev.toExponential(2)} of diagonal -->\n</svg>`);
    }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reconstructed.svg';
    a.click();
    URL.revokeObjectURL(a.href);
    const proof = dev != null ? `, round-trip max dev ${dev.toExponential(2)}` : '';
    store.flash(`exported reconstructed.svg — ${store.scene.shapes.length} shapes, ${countCoords(svg)} numbers${proof}`);
  }
</script>

<header class="toolbar">
  <div class="row">
    <span class="brand">
      <span class="dot" aria-hidden="true"></span>
      <h1>SVG Reconstruction</h1>
    </span>
    <span class="rule" aria-hidden="true"></span>
    <button class="ibtn" onclick={onopen} title="Open a preset, pasted, or local SVG"><Icon name="open" />Open new</button>
    <button
      class="ibtn ghost"
      onclick={() => loadSVG(store.inputSVG, { flatten: true })}
      disabled={!store.scene}
      title="Apply the forward model: destroy the construction the way an exporter would"><Icon name="flatten" />Flatten</button
    >
    <span class="gap"></span>
    <button class="ibtn primary" onclick={exportSVG} disabled={!store.scene} title="Export the reconstructed SVG"><Icon name="export" />Export</button>
  </div>
</header>

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  /* One small mark of primary so the header has an owner without a logo. */
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 3px;
    background: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
    flex: none;
  }
  .rule {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 2px;
  }
</style>
