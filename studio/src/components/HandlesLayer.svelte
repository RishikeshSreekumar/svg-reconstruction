<script lang="ts">
  import type { Handle } from '../lib/handles.ts';

  let { handles, unit, hot = null }: { handles: Handle[]; unit: number; hot?: number | null } = $props();
</script>

<g pointer-events="none">
  {#each handles as h, i}
    {@const isHot = i === hot}
    {#if h.radius}
      <!-- Radius handles draw hollow — they set a length, not a position. -->
      <circle
        cx={h.at.x}
        cy={h.at.y}
        r={(isHot ? 5.5 : 4.5) * unit}
        fill="#fff"
        stroke="var(--mark)"
        stroke-width={(isHot ? 2 : 1.5) * unit}
      />
    {:else}
      <rect
        x={h.at.x - (isHot ? 4.5 : 3.8) * unit}
        y={h.at.y - (isHot ? 4.5 : 3.8) * unit}
        width={(isHot ? 9 : 7.6) * unit}
        height={(isHot ? 9 : 7.6) * unit}
        fill="#fff"
        stroke="var(--mark)"
        stroke-width={(isHot ? 2 : 1.5) * unit}
      />
    {/if}
    {#if isHot}
      <text
        x={h.at.x + 8 * unit}
        y={h.at.y - 8 * unit}
        font-size={11 * unit}
        fill="var(--mark)"
        stroke="rgba(255, 255, 255, 0.9)"
        stroke-width={3 * unit}
        paint-order="stroke"
        style="font-family: ui-sans-serif, sans-serif">{h.hint}</text
      >
    {/if}
  {/each}
</g>
