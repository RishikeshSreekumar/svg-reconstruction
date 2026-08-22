import type { Guideline, Pt } from '../../../src/types.ts';

export interface SnapContext {
  /** Grid step in user units; undefined disables grid snapping. */
  gridStep?: number;
  guidelines: Guideline[];
  /** Snap reach in user units (convert ~6 screen px via pxScale). */
  tol: number;
  /** Alt bypasses snapping entirely. */
  bypass?: boolean;
}

export interface SnapResult {
  p: Pt;
  /** What the point snapped to, per axis-ish: guides beat grid. */
  hits: (Guideline | 'grid')[];
}

/** Choose a grid step ~10^k · {1,2,5} that is at least `minPx` on screen. */
export function gridStepFor(pxPerUnit: number, minPx = 12): number {
  const target = minPx / Math.max(pxPerUnit, 1e-12);
  const k = Math.floor(Math.log10(target));
  for (const m of [1, 2, 5]) {
    const step = m * 10 ** k;
    if (step >= target) return step;
  }
  return 10 ** (k + 1);
}

/**
 * Snap a point to guidelines first, then the grid, independently per axis.
 * Point guides and angled guides snap both axes at once when close enough.
 */
export function snapPoint(p: Pt, ctx: SnapContext): SnapResult {
  if (ctx.bypass) return { p, hits: [] };
  const out: Pt = { ...p };
  const hits: (Guideline | 'grid')[] = [];

  // A point guide (shared centre) is the strongest target: both axes at once.
  let best: Guideline | null = null;
  let bestD = ctx.tol;
  for (const g of ctx.guidelines) {
    if (g.kind !== 'point') continue;
    const d = Math.hypot(g.p.x - p.x, g.p.y - p.y);
    if (d <= bestD) {
      best = g;
      bestD = d;
    }
  }
  if (best && best.kind === 'point') {
    return { p: { ...best.p }, hits: [best] };
  }

  // Angled guides: perpendicular projection.
  for (const g of ctx.guidelines) {
    if (g.kind !== 'angled') continue;
    const n = { x: -g.dir.y, y: g.dir.x };
    const d = (p.x - g.p.x) * n.x + (p.y - g.p.y) * n.y;
    if (Math.abs(d) <= ctx.tol) {
      out.x = p.x - d * n.x;
      out.y = p.y - d * n.y;
      hits.push(g);
      return { p: out, hits };
    }
  }

  let xDone = false;
  let yDone = false;
  let bestV: Guideline | null = null;
  let bestH: Guideline | null = null;
  let dv = ctx.tol;
  let dh = ctx.tol;
  for (const g of ctx.guidelines) {
    if (g.kind === 'v' && Math.abs(g.x - p.x) <= dv) {
      bestV = g;
      dv = Math.abs(g.x - p.x);
    }
    if (g.kind === 'h' && Math.abs(g.y - p.y) <= dh) {
      bestH = g;
      dh = Math.abs(g.y - p.y);
    }
  }
  if (bestV && bestV.kind === 'v') {
    out.x = bestV.x;
    hits.push(bestV);
    xDone = true;
  }
  if (bestH && bestH.kind === 'h') {
    out.y = bestH.y;
    hits.push(bestH);
    yDone = true;
  }

  if (ctx.gridStep) {
    const snap = (v: number): number | null => {
      const g = Math.round(v / ctx.gridStep!) * ctx.gridStep!;
      return Math.abs(g - v) <= ctx.tol ? g : null;
    };
    if (!xDone) {
      const gx = snap(p.x);
      if (gx != null) {
        out.x = gx;
        if (!hits.includes('grid')) hits.push('grid');
      }
    }
    if (!yDone) {
      const gy = snap(p.y);
      if (gy != null) {
        out.y = gy;
        if (!hits.includes('grid')) hits.push('grid');
      }
    }
  }
  return { p: out, hits };
}

export function describeSnap(hits: (Guideline | 'grid')[]): string {
  if (!hits.length) return '';
  const names = hits.map((h) => (h === 'grid' ? 'grid' : h.label ?? `${h.role} ${h.kind === 'h' ? 'y' : h.kind === 'v' ? 'x' : ''}`.trim()));
  return `snap: ${[...new Set(names)].join(', ')}`;
}
