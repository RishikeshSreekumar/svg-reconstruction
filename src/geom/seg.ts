import type { ArcFit, Fit, Pt } from '../types.ts';
import { angNorm, norm, sub } from './vec.ts';

/**
 * Segment endpoint/tangent accessors, shared by the construction analysis, the
 * tangency repair and the editor. A `Fit` stores an arc as centre + angles, so
 * its endpoints are derived — which is the whole point: move the centre or the
 * radius and the endpoints follow, instead of being restated as coordinates.
 */

export const arcPt = (f: ArcFit, t: number): Pt => ({
  x: f.c.x + f.r * Math.cos(t),
  y: f.c.y + f.r * Math.sin(t),
});

/** Angle of `p` seen from `c`, in SVG screen space (y down). */
export const angleOfPt = (c: Pt, p: Pt): number => Math.atan2(p.y - c.y, p.x - c.x);

/** Travel direction around an arc: +1 for increasing angle. */
export const arcDir = (f: ArcFit): 1 | -1 => (f.a1 >= f.a0 ? 1 : -1);

/** Refresh the cached endpoints after `c`, `r`, `a0` or `a1` changed. */
export function syncArcEnds(f: ArcFit): void {
  f.a = arcPt(f, f.a0);
  f.b = arcPt(f, f.a1);
}

/** Start point of a segment in travel order. Null for whole closed contours. */
export function segStart(f: Fit): Pt | null {
  switch (f.kind) {
    case 'line':
      return f.a;
    case 'arc':
      return arcPt(f, f.a0);
    case 'cubic':
      return f.pts.length ? f.pts[0] : null;
    default:
      return null;
  }
}

/** End point of a segment in travel order. */
export function segEnd(f: Fit): Pt | null {
  switch (f.kind) {
    case 'line':
      return f.b;
    case 'arc':
      return arcPt(f, f.a1);
    case 'cubic':
      return f.pts.length ? f.pts[f.pts.length - 1] : null;
    default:
      return null;
  }
}

export const segPt = (f: Fit, end: 'start' | 'end'): Pt | null => (end === 'start' ? segStart(f) : segEnd(f));

/** Unit tangent in the direction of travel, at one end of a segment. */
export function segTangent(f: Fit, end: 'start' | 'end'): Pt | null {
  switch (f.kind) {
    case 'line': {
      const d = norm(sub(f.b, f.a));
      return d.x === 0 && d.y === 0 ? null : d;
    }
    case 'arc': {
      const t = end === 'start' ? f.a0 : f.a1;
      const sign = arcDir(f);
      return norm({ x: -Math.sin(t) * sign, y: Math.cos(t) * sign });
    }
    case 'cubic': {
      const p = f.pts;
      if (p.length < 2) return null;
      const d = end === 'start' ? sub(p[1], p[0]) : sub(p[p.length - 1], p[p.length - 2]);
      const u = norm(d);
      return u.x === 0 && u.y === 0 ? null : u;
    }
    default:
      return null;
  }
}

/**
 * Re-angle one end of an arc to `theta`, keeping the other end and the travel
 * direction. The sweep is taken the short way round the direction of travel, so
 * a small move of the endpoint stays a small change of sweep.
 */
export function reangle(f: ArcFit, end: 'start' | 'end', theta: number): void {
  const dir = arcDir(f);
  if (end === 'start') f.a0 = f.a1 - dir * angNorm(dir * (f.a1 - theta));
  else f.a1 = f.a0 + dir * angNorm(dir * (theta - f.a0));
  syncArcEnds(f);
}
