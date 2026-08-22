import type { Fit, LineFit, Pt } from '../types.ts';
import { cross, dist, dot, norm, sub } from '../geom/vec.ts';
import { directedHausdorff, hausdorff } from '../geom/poly.ts';
import { angleOfPt, arcPt, reangle, segTangent } from '../geom/seg.ts';
import { sampleFit } from './primitives.ts';

/**
 * Tangency repair.
 *
 * A tangent join carries no curvature discontinuity, so the corner detector has
 * nothing to lock onto and the split between an arc and the line leaving it
 * lands a few samples off. Each piece is then fitted over slightly the wrong
 * run: the arc comes back a few degrees short and the line a few degrees
 * rotated, which reads out as a 3-degree kink where the artwork has none.
 *
 * This moves the shared point to the true tangent point, so a half-turn reports
 * as 180 degrees and a tangent line reports as tangent. The repaired chain is
 * verified against the source polyline and discarded if it drifts — that check
 * is also what stops a genuine shallow corner from being flattened into a
 * tangency, since enforcing one there moves the geometry far off the artwork.
 *
 * Only line-to-arc joins are repaired. Arc-to-arc tangency additionally
 * requires the two centres to sit at r1 +/- r2 apart, which means moving a
 * centre — a solve across the whole chain, not a local fix.
 */

/** Joins wider than this are treated as intended corners and left alone. */
const NEAR_TANGENT = 0.35; // ~20 degrees

function joinAngle(f: Fit, g: Fit): number | null {
  const a = segTangent(f, 'end');
  const b = segTangent(g, 'start');
  if (!a || !b) return null;
  return Math.abs(Math.atan2(cross(a, b), dot(a, b)));
}

/**
 * Tangent point on circle (c, r) from the external point p, taking whichever of
 * the two solutions sits nearer to `near` — the join point we are replacing.
 */
function tangentPoint(p: Pt, c: Pt, r: number, near: Pt): Pt | null {
  const d = dist(p, c);
  if (!(d > r)) return null; // p inside the circle: no tangent from it
  const u = norm(sub(p, c));
  const alpha = Math.acos(Math.max(-1, Math.min(1, r / d)));
  const rot = (a: number): Pt => ({
    x: c.x + r * (u.x * Math.cos(a) - u.y * Math.sin(a)),
    y: c.y + r * (u.x * Math.sin(a) + u.y * Math.cos(a)),
  });
  const t1 = rot(alpha);
  const t2 = rot(-alpha);
  return dist(t1, near) <= dist(t2, near) ? t1 : t2;
}

function clone(f: Fit): Fit {
  return f.kind === 'cubic' ? { ...f, pts: f.pts.slice() } : { ...f };
}

function chainSamples(fits: Fit[]): Pt[] {
  const out: Pt[] = [];
  for (const f of fits) for (const p of sampleFit(f, 48)) out.push(p);
  return out;
}

/** Move a line's free end, leaving the other end where it is. */
function setLineEnd(f: LineFit, end: 'a' | 'b', p: Pt): void {
  if (end === 'a') f.a = p;
  else f.b = p;
}

/**
 * Enforce tangency at joins that are already nearly tangent.
 * Returns the original array unchanged when no repair applies or when the
 * repaired chain no longer matches the source within `tol`.
 */
export function snapTangencies(fits: Fit[], poly: Pt[], closed: boolean, tol: number, g1Tol: number): Fit[] {
  if (fits.length < 2) return fits;

  const before = hausdorff(chainSamples(fits), poly);
  const work = fits.map(clone);
  let touched = false;

  // A near-straight arc first. A short run next to a real arc sometimes fits a
  // huge-radius arc better than a line does, and that arc then blocks the repair
  // below, which only handles line-to-arc joins. The test is the sagitta: if the
  // chord sits within `tol` of the arc, the arc was a line all along — and a line
  // carries one parameter fewer, so this never loses on MDL either.
  for (let i = 0; i < work.length; i++) {
    const f = work[i];
    if (f.kind !== 'arc') continue;
    const sag = f.r * (1 - Math.cos(Math.abs(f.a1 - f.a0) / 2));
    if (sag > tol) continue;
    work[i] = {
      kind: 'line',
      a: arcPt(f, f.a0),
      b: arcPt(f, f.a1),
      maxDev: f.maxDev,
      rmsDev: f.rmsDev,
      params: 4,
    };
    touched = true;
  }

  // Three passes: repairing a join moves an endpoint that its neighbour's own
  // repair depends on, so the chain settles rather than resolving in one sweep.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < work.length; i++) {
      const j = i + 1 < work.length ? i + 1 : closed ? 0 : -1;
      if (j < 0) continue;
      const f = work[i];
      const g = work[j];
      const ang = joinAngle(f, g);
      if (ang == null || ang <= g1Tol || ang > NEAR_TANGENT) continue;

      if (f.kind === 'line' && g.kind === 'arc') {
        const T = tangentPoint(f.a, g.c, g.r, f.b);
        if (!T) continue;
        setLineEnd(f, 'b', T);
        reangle(g, 'start', angleOfPt(g.c, T));
        touched = true;
      } else if (f.kind === 'arc' && g.kind === 'line') {
        const T = tangentPoint(g.b, f.c, f.r, g.a);
        if (!T) continue;
        setLineEnd(g, 'a', T);
        reangle(f, 'end', angleOfPt(f.c, T));
        touched = true;
      }
    }
  }
  if (!touched) return fits;

  const after = hausdorff(chainSamples(work), poly);
  // Gate on the project's global accept threshold, and refuse a repair that
  // makes an already-good chain markedly worse.
  if (after > tol || after > Math.max(before * 2, tol * 0.5)) return fits;

  for (const f of work) f.maxDev = directedHausdorff(sampleFit(f, 64), poly);
  return work;
}
