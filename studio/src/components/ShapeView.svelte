<script lang="ts">
  import type { Cutout, Shape } from '../../../src/types.ts';
  import { contourToD } from '../../../src/index.ts';

  let {
    s,
    hitPad = 0,
    unit = 1,
    selected = false,
    hovered = false,
    viewBox = [0, 0, 100, 100],
  }: { s: Shape; hitPad?: number; unit?: number; selected?: boolean; hovered?: boolean; viewBox?: [number, number, number, number] } = $props();

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
  // Copied, not aliased: `s` is a shallow clone, so sharing the cutouts array
  // would hide length changes behind an unchanged reference.
  const cuts = $derived([...(s.cutouts ?? [])]);
  const maskId = $derived(`cut-preview-${s.id.replace(/[^a-zA-Z0-9_.-]/g, '_')}`);
  const cutPathD = (c: Extract<Cutout, { kind: 'path' }>): string => c.contours.map((x) => contourToD(x, 3)).join('');
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

{#snippet cutGeom(c: Cutout, attrs: Record<string, unknown>)}
  {#if c.kind === 'circle'}
    <circle cx={c.c.x} cy={c.c.y} r={c.r} {...attrs} />
  {:else if c.kind === 'ellipse'}
    <ellipse cx={c.c.x} cy={c.c.y} rx={c.rx} ry={c.ry} transform={c.rot !== 0 ? `rotate(${deg(c.rot)} ${c.c.x} ${c.c.y})` : undefined} {...attrs} />
  {:else if c.kind === 'rect'}
    <rect
      x={c.x}
      y={c.y}
      width={c.w}
      height={c.h}
      rx={c.rx > 0 ? c.rx : undefined}
      transform={Math.abs(c.rot) > 1e-9 ? `rotate(${deg(c.rot)} ${c.x} ${c.y})` : undefined}
      {...attrs}
    />
  {:else if c.kind === 'polygon'}
    <polygon points={c.pts.map((q) => `${q.x},${q.y}`).join(' ')} {...attrs} />
  {:else}
    <path d={cutPathD(c)} fill-rule={c.fillRule === 'evenodd' ? 'evenodd' : undefined} {...attrs} />
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
    {#if cuts.length}
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} style="mask-type: luminance">
          <rect x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} fill="white" />
          {#each cuts as c}{@render cutGeom(c, { fill: 'black', stroke: 'none' })}{/each}
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        {@render geom(vis)}
        {#if needsTwin}{@render geom(twin)}{/if}
      </g>
    {:else}
      {@render geom(vis)}
      {#if needsTwin}{@render geom(twin)}{/if}
    {/if}
  {/if}
  {#if selected || hovered}
    <g mask={cuts.length ? `url(#${maskId})` : undefined}>{@render geom(outline)}</g>
    {#each cuts as c}{@render cutGeom(c, outline)}{/each}
  {/if}
</g>
