<script lang="ts">
  import type { SpecHighlight } from '../lib/spec.ts';

  let {
    hl,
    viewBox,
    unit,
  }: {
    hl: SpecHighlight;
    viewBox: [number, number, number, number];
    unit: number;
  } = $props();

  const [vx, vy, vw, vh] = $derived(viewBox);
  const diag = $derived(Math.hypot(vw, vh));

  // Hovered spec rows draw in the "hot" gold of the existing mark language.
  const HOT = 'var(--mark-hot)';

  const axisPts = $derived.by(() => {
    if (!hl.axis) return null;
    const { p, dir } = hl.axis;
    const L = diag * 2;
    return { x1: p.x - dir.x * L, y1: p.y - dir.y * L, x2: p.x + dir.x * L, y2: p.y + dir.y * L };
  });
</script>

<g fill="none" pointer-events="none">
  {#if hl.box}
    <rect
      x={hl.box[0]}
      y={hl.box[1]}
      width={hl.box[2]}
      height={hl.box[3]}
      stroke={HOT}
      stroke-width={unit}
      stroke-dasharray={`${6 * unit} ${4 * unit}`}
    />
  {/if}
  {#if axisPts}
    <line x1={axisPts.x1} y1={axisPts.y1} x2={axisPts.x2} y2={axisPts.y2} stroke={HOT} stroke-width={unit} stroke-dasharray={`${6 * unit} ${4 * unit}`} />
  {/if}
  {#each hl.circles ?? [] as c, i (i)}
    <circle cx={c.c.x} cy={c.c.y} r={c.r} stroke={HOT} stroke-width={0.8 * unit} opacity="0.9" />
    <line x1={c.c.x} y1={c.c.y} x2={c.c.x + c.r} y2={c.c.y} stroke={HOT} stroke-width={0.6 * unit} stroke-dasharray={`${3 * unit} ${2 * unit}`} />
  {/each}
  {#each hl.points ?? [] as p, i (i)}
    <circle cx={p.x} cy={p.y} r={2 * unit} fill={HOT} stroke="none" />
  {/each}
  {#if hl.label && hl.at}
    <text
      x={hl.at.x}
      y={hl.at.y - 8 * unit}
      font-size={11 * unit}
      text-anchor="middle"
      fill="var(--mark-amber)"
      stroke="rgba(255, 255, 255, 0.92)"
      stroke-width={3 * unit}
      paint-order="stroke"
      style="font-family: ui-sans-serif, sans-serif">{hl.label}</text
    >
  {/if}
</g>
