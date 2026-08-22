import type { Pt } from '../types.ts';
import { add, angDiff, cross, dist, mul, norm, perp, sub } from './vec.ts';

export type Cap = 'butt' | 'round' | 'square';
export type Join = 'miter' | 'round' | 'bevel';

const MITER_LIMIT = 4;

/** Points along a circular arc from `a0` sweeping by the signed `sweep`. */
function arcSweep(c: Pt, r: number, a0: number, sweep: number, out: Pt[]): void {
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 0.2));
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
}

interface Seg {
  a: Pt;
  b: Pt;
  /** Left normal of the segment direction. */
  n: Pt;
}

function buildSegs(pts: Pt[], closed: boolean): Seg[] {
  const p = pts.slice();
  if (closed && p.length > 1 && dist(p[0], p[p.length - 1]) < 1e-12) p.pop();
  const segs: Seg[] = [];
  const n = p.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    if (dist(a, b) < 1e-12) continue;
    segs.push({ a, b, n: perp(norm(sub(b, a))) });
  }
  return segs;
}

function miterPoint(p: Seg, s: Seg, r: number): Pt | null {
  const A1 = add(p.a, mul(p.n, r));
  const d1 = sub(p.b, p.a);
  const A2 = add(s.a, mul(s.n, r));
  const d2 = sub(s.b, s.a);
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((A2.x - A1.x) * d2.y - (A2.y - A1.y) * d2.x) / den;
  return { x: A1.x + d1.x * t, y: A1.y + d1.y * t };
}

/**
 * Emit the offset geometry at the vertex shared by `prev` and `s`.
 *
 * Only one point (or one arc) is emitted per vertex. Pushing both segments'
 * offset endpoints instead would leave a spurious out-and-back spike at every
 * concave join.
 */
function addJoin(out: Pt[], prev: Seg, s: Seg, r: number, join: Join): void {
  const turn = cross(sub(prev.b, prev.a), sub(s.b, s.a));
  const convex = turn < 0; // turning right => the left side opens up
  const pOut = add(s.a, mul(prev.n, r));
  const nOut = add(s.a, mul(s.n, r));

  if (convex && join === 'round') {
    const a0 = Math.atan2(prev.n.y, prev.n.x);
    const a1 = Math.atan2(s.n.y, s.n.x);
    // Always the short way: a join never sweeps more than PI.
    arcSweep(s.a, Math.abs(r), a0, angDiff(a1, a0), out);
    return;
  }
  if (convex && join === 'bevel') {
    out.push(pOut, nOut);
    return;
  }
  const m = miterPoint(prev, s, r);
  if (m && dist(m, s.a) <= Math.abs(r) * MITER_LIMIT) out.push(m);
  else out.push(pOut, nOut); // miter too long: fall back to a bevel
}

/**
 * Offset a polyline by `r` to its left. When `closed`, the seam vertex gets a
 * join like any other and the result comes back as a closed loop.
 */
export function offsetSide(pts: Pt[], r: number, join: Join = 'round', closed = false): Pt[] {
  const segs = buildSegs(pts, closed);
  if (!segs.length) return [];
  const out: Pt[] = [];

  // One emission per vertex; the straight runs between them are implied.
  if (!closed) out.push(add(segs[0].a, mul(segs[0].n, r)));
  for (let i = 0; i < segs.length; i++) {
    const prev = i > 0 ? segs[i - 1] : closed ? segs[segs.length - 1] : null;
    if (prev) addJoin(out, prev, segs[i], r, join);
  }
  if (closed) closeLoop(out);
  else out.push(add(segs[segs.length - 1].b, mul(segs[segs.length - 1].n, r)));
  return out;
}

function addCap(out: Pt[], p: Pt, dir: Pt, r: number, cap: Cap): void {
  const n = perp(dir);
  if (cap === 'round') {
    // From the left normal around the tip to the right normal: sweep of -PI.
    arcSweep(p, r, Math.atan2(n.y, n.x), -Math.PI, out);
  } else if (cap === 'square') {
    out.push(add(add(p, mul(n, r)), mul(dir, r)));
    out.push(add(add(p, mul(n, -r)), mul(dir, r)));
  }
  // butt: nothing; the two side endpoints already meet across the end
}

/**
 * Expand a stroked centerline into its filled outline.
 * Open centerlines yield one loop; closed ones yield [outer, inner].
 */
export function expandStroke(
  centerline: Pt[],
  width: number,
  closed: boolean,
  cap: Cap = 'butt',
  join: Join = 'round',
): Pt[][] {
  const r = width / 2;
  if (centerline.length < 2 || r <= 0) return [];

  if (closed) {
    return [offsetSide(centerline, r, join, true), offsetSide(centerline.slice().reverse(), r, join, true)];
  }

  const fwd = offsetSide(centerline, r, join, false);
  const back = offsetSide(centerline.slice().reverse(), r, join, false);
  if (!fwd.length || !back.length) return [];

  const out: Pt[] = [...fwd];
  const endDir = norm(sub(centerline[centerline.length - 1], centerline[centerline.length - 2]));
  const startDir = norm(sub(centerline[1], centerline[0]));
  addCap(out, centerline[centerline.length - 1], endDir, r, cap);
  out.push(...back);
  addCap(out, centerline[0], mul(startDir, -1), r, cap);
  closeLoop(out);
  return [out];
}

function closeLoop(pts: Pt[]): Pt[] {
  if (pts.length && dist(pts[0], pts[pts.length - 1]) > 1e-12) pts.push({ ...pts[0] });
  return pts;
}
