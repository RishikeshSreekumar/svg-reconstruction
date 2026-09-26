<script lang="ts">
  import { bboxOf, bboxDiag, cloudOf, countCoords, flattenSVG, hausdorff, reconstructSVG, sceneToSVG } from '../../../src/index.ts';
  import { store } from '../state/scene.svelte.ts';
  import { loadSVG } from '../lib/svg-load.ts';
  import { tooltip } from '../lib/tooltip.ts';
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
      <!-- The mark (public/brand/mark.svg) at 18px: the dashed construction
           circle is dropped at this size, keeping the ink shape, radius line,
           and ringed center — same cut as the favicon. -->
      <svg class="mark" viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
        <path d="M3 7 Q3 3 7 3 H14 A15 15 0 0 1 29 18 V25 Q29 29 25 29 H7 Q3 29 3 25 Z" fill="var(--primary)" />
        <path d="M14 18 L24.6 7.4" stroke="var(--bg)" stroke-opacity=".9" stroke-width="1.8" stroke-linecap="round" />
        <circle cx="14" cy="18" r="3.2" fill="var(--primary)" stroke="var(--bg)" stroke-width="1.8" />
      </svg>
      <h1>SVG Reconstruction</h1>
    </span>
    <span class="rule" aria-hidden="true"></span>
    <button class="ibtn" onclick={onopen} use:tooltip={{ text: 'Open a preset, pasted, or local SVG', place: 'bottom' }}><Icon name="open" />Open new</button>
    <button
      class="ibtn ghost"
      onclick={() => loadSVG(store.inputSVG, { flatten: true })}
      disabled={!store.scene}
      use:tooltip={{ text: 'Apply the forward model: destroy the construction the way an exporter would', place: 'bottom' }}><Icon name="flatten" />Flatten</button
    >
    <span class="gap"></span>
    <button class="ibtn primary" onclick={exportSVG} disabled={!store.scene} use:tooltip={{ text: 'Export the reconstructed SVG', place: 'bottom' }}><Icon name="export" />Export</button>
  </div>
</header>

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .mark {
    flex: none;
    display: block;
  }
  .rule {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 2px;
  }
</style>
