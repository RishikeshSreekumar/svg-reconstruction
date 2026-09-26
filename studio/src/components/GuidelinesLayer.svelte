<script lang="ts">
  import type { Guideline, Scene, Shape } from '../../../src/types.ts';

  let {
    scene,
    viewBox,
    unit,
    selected,
    selectedSegKey,
  }: {
    scene: Scene;
    viewBox: [number, number, number, number];
    unit: number;
    selected: string | null;
    selectedSegKey: string | null;
  } = $props();

  const [vx, vy, vw, vh] = $derived(viewBox);
  const diag = $derived(Math.hypot(vw, vh));

  // Clone per update: user guides are mutated in place while dragged, and the
  // keyed each-block would skip rows whose object reference is unchanged.
  const guides = $derived((scene.guidelines ?? []).map((g) => ({ ...g }) as Guideline));

  const colorOf = (g: Guideline): string => {
    if (g.source === 'user') return 'var(--mark)';
    return selected != null && g.from?.includes(selected) ? 'var(--mark-hot)' : 'var(--mark-amber)';
  };

  /** Endpoints for an angled guide, clipped generously to the view. */
  const angledPts = (g: Extract<Guideline, { kind: 'angled' }>): { x1: number; y1: number; x2: number; y2: number } => {
    const L = diag * 2;
    return { x1: g.p.x - g.dir.x * L, y1: g.p.y - g.dir.y * L, x2: g.p.x + g.dir.x * L, y2: g.p.y + g.dir.y * L };
  };

  const selectedShape = $derived((selected && scene.shapes.find((s) => s.id === selected)) || null);

  const marks = $derived.by(() => {
    // The selected shape's own construction: centres, radius rays, and each
    // arc's construction circle — the way a spec sheet draws them.
    const s = selectedShape;
    const out: { tag: 'circle' | 'line' | 'dot' | 'ctrl'; a: Record<string, number>; hot: boolean }[] = [];
    if (!s) return out;
    const dot = (x: number, y: number, hot = false): void => {
      out.push({ tag: 'dot', a: { cx: x, cy: y, r: 2 * unit }, hot });
    };
    if (s.kind === 'circle' || s.kind === 'ellipse' || s.kind === 'polygon') {
      dot(s.c.x, s.c.y);
      if (s.kind === 'circle') out.push({ tag: 'line', a: { x1: s.c.x, y1: s.c.y, x2: s.c.x + s.r, y2: s.c.y }, hot: false });
    }
    if (s.kind === 'rect') dot(s.x, s.y);
    if (s.kind === 'line') {
      dot(s.a.x, s.a.y);
      dot(s.b.x, s.b.y);
    }
    if (s.kind === 'path') {
      s.contours.forEach((c, ci) => {
        c.segs.forEach((f, i) => {
          const hot = selectedSegKey === `${s.id}#${ci}.${i}`;
          if (f.kind === 'line') dot(f.a.x, f.a.y, hot);
          if (f.kind === 'arc') {
            out.push({ tag: 'circle', a: { cx: f.c.x, cy: f.c.y, r: f.r }, hot });
            dot(f.c.x, f.c.y, hot);
            dot(f.a.x, f.a.y, hot);
          }
          if (f.kind === 'cubic' && f.c1 && f.c2 && f.pts.length >= 2) {
            // A bezier's construction is its control polygon: the tangent
            // line each endpoint shares with its control point.
            const p0 = f.pts[0];
            const p3 = f.pts[f.pts.length - 1];
            out.push({ tag: 'line', a: { x1: p0.x, y1: p0.y, x2: f.c1.x, y2: f.c1.y }, hot });
            out.push({ tag: 'line', a: { x1: p3.x, y1: p3.y, x2: f.c2.x, y2: f.c2.y }, hot });
            dot(p0.x, p0.y, hot);
            out.push({ tag: 'ctrl', a: { cx: f.c1.x, cy: f.c1.y, r: 2.4 * unit }, hot });
            out.push({ tag: 'ctrl', a: { cx: f.c2.x, cy: f.c2.y, r: 2.4 * unit }, hot });
          }
        });
      });
    }
    return out;
  });

  const spokes = $derived.by(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; active: boolean }[] = [];
    for (const c of scene.constraints) {
      if (c.kind !== 'rotational') continue;
      const active = selected != null && c.ids.includes(selected);
      const ray = Math.min(vw, vh) * 0.12;
      for (let i = 0; i < c.order; i++) {
        const a = (2 * Math.PI * i) / c.order;
        out.push({ x1: c.c.x, y1: c.c.y, x2: c.c.x + ray * Math.cos(a), y2: c.c.y + ray * Math.sin(a), active });
      }
    }
    return out;
  });
</script>

<g fill="none" pointer-events="none">
  {#each guides as g (g.id)}
    {@const col = colorOf(g)}
    {#if g.kind === 'h'}
      <line x1={vx - vw} y1={g.y} x2={vx + 2 * vw} y2={g.y} stroke={col} stroke-width={unit} stroke-dasharray={`${6 * unit} ${4 * unit}`} />
      {#if g.label}<text x={vx + 4 * unit} y={g.y - 3 * unit} font-size={9 * unit} fill={col}>{g.label}</text>{/if}
      {#if g.source === 'user'}
        <line data-guide-id={g.id} x1={vx - vw} y1={g.y} x2={vx + 2 * vw} y2={g.y} stroke="transparent" stroke-width={12 * unit} style="pointer-events: stroke; cursor: ns-resize" />
      {/if}
    {:else if g.kind === 'v'}
      <line x1={g.x} y1={vy - vh} x2={g.x} y2={vy + 2 * vh} stroke={col} stroke-width={unit} stroke-dasharray={`${6 * unit} ${4 * unit}`} />
      {#if g.label}<text x={g.x + 3 * unit} y={vy + 12 * unit} font-size={9 * unit} fill={col}>{g.label}</text>{/if}
      {#if g.source === 'user'}
        <line data-guide-id={g.id} x1={g.x} y1={vy - vh} x2={g.x} y2={vy + 2 * vh} stroke="transparent" stroke-width={12 * unit} style="pointer-events: stroke; cursor: ew-resize" />
      {/if}
    {:else if g.kind === 'angled'}
      {@const p = angledPts(g)}
      <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={col} stroke-width={unit} stroke-dasharray={`${6 * unit} ${4 * unit}`} opacity="0.8" />
      {#if g.source === 'user'}
        <line data-guide-id={g.id} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="transparent" stroke-width={12 * unit} style="pointer-events: stroke; cursor: move" />
      {/if}
    {:else if g.kind === 'point'}
      <line x1={g.p.x - 7 * unit} y1={g.p.y} x2={g.p.x + 7 * unit} y2={g.p.y} stroke={col} stroke-width={unit} />
      <line x1={g.p.x} y1={g.p.y - 7 * unit} x2={g.p.x} y2={g.p.y + 7 * unit} stroke={col} stroke-width={unit} />
      <circle cx={g.p.x} cy={g.p.y} r={5 * unit} stroke={col} stroke-width={unit} />
    {/if}
  {/each}

  {#each spokes as sp}
    <line x1={sp.x1} y1={sp.y1} x2={sp.x2} y2={sp.y2} stroke={sp.active ? 'var(--mark-hot)' : 'var(--mark-amber)'} stroke-width={unit} stroke-dasharray={`${4 * unit} ${3 * unit}`} />
  {/each}

  <!-- Monochrome marks need a white casing to stay legible where they cross
       the artwork's own black ink — same idiom as the spec labels. -->
  {#each marks as m}
    {@const col = m.hot ? 'var(--mark-hot)' : 'var(--mark)'}
    {#if m.tag === 'circle'}
      <circle cx={m.a.cx} cy={m.a.cy} r={m.a.r} stroke="rgba(255, 255, 255, 0.85)" stroke-width={2 * unit} opacity={m.hot ? 0.9 : 0.45} />
      <circle cx={m.a.cx} cy={m.a.cy} r={m.a.r} stroke={col} stroke-width={0.6 * unit} opacity={m.hot ? 0.9 : 0.45} />
    {:else if m.tag === 'ctrl'}
      <circle cx={m.a.cx} cy={m.a.cy} r={m.a.r} stroke="rgba(255, 255, 255, 0.85)" stroke-width={2.4 * unit} />
      <circle cx={m.a.cx} cy={m.a.cy} r={m.a.r} stroke={col} stroke-width={unit} />
    {:else if m.tag === 'line'}
      <line x1={m.a.x1} y1={m.a.y1} x2={m.a.x2} y2={m.a.y2} stroke="rgba(255, 255, 255, 0.85)" stroke-width={2.4 * unit} stroke-dasharray={`${4 * unit} ${3 * unit}`} />
      <line x1={m.a.x1} y1={m.a.y1} x2={m.a.x2} y2={m.a.y2} stroke={col} stroke-width={unit} stroke-dasharray={`${4 * unit} ${3 * unit}`} />
    {:else}
      <circle cx={m.a.cx} cy={m.a.cy} r={m.a.r} fill={col} stroke="rgba(255, 255, 255, 0.85)" stroke-width={unit} />
    {/if}
  {/each}
</g>
