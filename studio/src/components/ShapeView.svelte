<script lang="ts">
  import type { Shape } from '../../../src/types.ts';
  import { contourToD } from '../../../src/index.ts';

  let {
    s,
    hitPad = 0,
    unit = 1,
    selected = false,
    hovered = false,
  }: { s: Shape; hitPad?: number; unit?: number; selected?: boolean; hovered?: boolean } = $props();

  const deg = (r: number): number => (r * 180) / Math.PI;

  // Painted exactly like the exporter paints it, so what you edit is what you get.
  const vis = $derived({
    fill: s.style.fill ?? 'none',
    stroke: s.style.stroke ?? undefined,
    'stroke-width': s.style.stroke ? (s.style.strokeWidth ?? 1) : undefined,
    'stroke-linecap': s.style.strokeLinecap && s.style.strokeLinecap !== 'butt' ? s.style.strokeLinecap : undefined,
    'stroke-linejoin': s.style.strokeLinejoin && s.style.strokeLinejoin !== 'miter' ? s.style.strokeLinejoin : undefined,
    'fill-rule': (s.style.fillRule === 'evenodd' ? 'evenodd' : undefined) as 'evenodd' | undefined,
    opacity: s.style.opacity != null && s.style.opacity !== 1 ? s.style.opacity : undefined,
  });

  // A stroke-only shape has almost no painted area to click; the twin is the
  // same geometry with a fat transparent stroke that only exists for hit tests.
  const needsTwin = $derived(s.style.fill == null && s.kind !== 'text');
  const twin = $derived({
    fill: 'none',
    stroke: 'transparent',
    'stroke-width': Math.max(s.style.strokeWidth ?? 0, hitPad),
    style: 'pointer-events: stroke',
  });

  // Selection / hover feedback: the same geometry traced in the accent colour.
  const outline = $derived({
    fill: 'none',
    stroke: selected ? 'var(--mark)' : 'var(--mark-soft)',
    'stroke-width': 1.4 * unit,
    'stroke-dasharray': selected ? undefined : `${3 * unit} ${3 * unit}`,
    style: 'pointer-events: none',
  });

  const pathD = $derived(s.kind === 'path' ? s.contours.map((c) => contourToD(c, 3)).join('') : '');
  const polyPts = $derived(s.kind === 'polygon' ? s.pts.map((q) => `${q.x},${q.y}`).join(' ') : '');
</script>

{#snippet geom(attrs: Record<string, unknown>)}
  {#if s.kind === 'circle'}
    <circle cx={s.c.x} cy={s.c.y} r={s.r} {...attrs} />
  {:else if s.kind === 'ellipse'}
    <ellipse
      cx={s.c.x}
      cy={s.c.y}
      rx={s.rx}
      ry={s.ry}
      transform={s.rot !== 0 ? `rotate(${deg(s.rot)} ${s.c.x} ${s.c.y})` : undefined}
      {...attrs}
    />
  {:else if s.kind === 'rect'}
    <rect
      x={s.x}
      y={s.y}
      width={s.w}
      height={s.h}
      rx={s.rx > 0 ? s.rx : undefined}
      transform={Math.abs(s.rot) > 1e-9 ? `rotate(${deg(s.rot)} ${s.x} ${s.y})` : undefined}
      {...attrs}
    />
  {:else if s.kind === 'line'}
    <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} {...attrs} />
  {:else if s.kind === 'polygon'}
    <polygon points={polyPts} {...attrs} />
  {:else if s.kind === 'path'}
    <path d={pathD} {...attrs} />
  {/if}
{/snippet}

<g data-shape-id={s.id}>
  {#if s.kind === 'text'}
    <text
      x={s.p.x}
      y={s.p.y}
      font-size={s.fontSize}
      font-family={s.fontFamily}
      text-anchor={s.anchor !== 'start' ? s.anchor : undefined}
      fill={s.style.fill ?? 'black'}
      style="pointer-events: bounding-box">{s.text}</text
    >
  {:else}
    {@render geom(vis)}
    {#if needsTwin}{@render geom(twin)}{/if}
  {/if}
  {#if selected || hovered}
    {@render geom(outline)}
  {/if}
</g>
