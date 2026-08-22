import type { BBox, Pt } from '../types.ts';
import { dist, ptSegDist, sub, norm, dot } from './vec.ts';

/** Shoelace signed area. Positive == counter-clockwise in math axes (clockwise on screen). */
export function signedArea(poly: Pt[]): number {
  let s = 0;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    s += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  }
  return s / 2;
}

export function bboxOf(pts: Pt[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export const bboxDiag = (b: BBox): number => Math.hypot(b.x1 - b.x0, b.y1 - b.y0);

export function bboxContains(outer: BBox, inner: BBox, eps = 0): boolean {
  return (
    inner.x0 >= outer.x0 - eps &&
    inner.y0 >= outer.y0 - eps &&
    inner.x1 <= outer.x1 + eps &&
    inner.y1 <= outer.y1 + eps
  );
}

/** Cumulative arclength; result has poly.length entries, first is 0. */
export function cumLength(poly: Pt[]): number[] {
  const out = new Array<number>(poly.length);
  out[0] = 0;
  for (let i = 1; i < poly.length; i++) out[i] = out[i - 1] + dist(poly[i - 1], poly[i]);
  return out;
}

export const totalLength = (poly: Pt[]): number => cumLength(poly)[poly.length - 1] ?? 0;

/** Resample a polyline to `n` points at uniform arclength. Keeps endpoints. */
export function resample(poly: Pt[], n: number): Pt[] {
  if (poly.length < 2 || n < 2) return poly.slice();
  const cum = cumLength(poly);
  const total = cum[cum.length - 1];
  if (total === 0) return poly.slice(0, 1);
  const out: Pt[] = [poly[0]];
  let j = 1;
  for (let i = 1; i < n - 1; i++) {
    const target = (total * i) / (n - 1);
    while (j < cum.length - 1 && cum[j] < target) j++;
    const t0 = cum[j - 1];
    const t1 = cum[j];
    const u = t1 > t0 ? (target - t0) / (t1 - t0) : 0;
    out.push({
      x: poly[j - 1].x + (poly[j].x - poly[j - 1].x) * u,
      y: poly[j - 1].y + (poly[j].y - poly[j - 1].y) * u,
    });
  }
  out.push(poly[poly.length - 1]);
  return out;
}

/**
 * Insert points so no segment is longer than `maxSeg`, keeping every original
 * vertex. Unlike `resample` this preserves corners exactly — and without it a
 * straight edge carries only its two endpoints, which any circle can fit.
 */
export function densify(poly: Pt[], maxSeg: number, cap = 4000): Pt[] {
  if (poly.length < 2 || maxSeg <= 0) return poly.slice();
  const total = totalLength(poly);
  const step = Math.max(maxSeg, total / cap);
  const out: Pt[] = [];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    out.push(a);
    const d = dist(a, b);
    const k = Math.ceil(d / step);
    for (let s = 1; s < k; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / k, y: a.y + ((b.y - a.y) * s) / k });
    }
  }
  out.push(poly[poly.length - 1]);
  return out;
}

/** Shortest distance from p to the polyline. */
export function ptPolyDist(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const d = ptSegDist(p, poly[i - 1], poly[i]);
    if (d < best) best = d;
  }
  return best;
}

/** One-sided max distance from every point of `a` to polyline `b`. */
export function directedHausdorff(a: Pt[], b: Pt[]): number {
  let worst = 0;
  for (const p of a) {
    const d = ptPolyDist(p, b);
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * Symmetric Hausdorff between two polylines. This is the gate for accepting a
 * reconstruction — mean error hides single bad spikes, max does not.
 */
export function hausdorff(a: Pt[], b: Pt[]): number {
  return Math.max(directedHausdorff(a, b), directedHausdorff(b, a));
}

/** Even-odd point-in-polygon. */
export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = poly[i].y;
    const yj = poly[j].y;
    if (yi > p.y !== yj > p.y) {
      const x = poly[i].x + ((p.y - yi) / (yj - yi)) * (poly[j].x - poly[i].x);
      if (x > p.x) inside = !inside;
    }
  }
  return inside;
}

/** True when every sampled point of `inner` lies inside `outer`. */
export function polyInsidePoly(inner: Pt[], outer: Pt[], sampleN = 24): boolean {
  const s = resample(inner, Math.min(sampleN, inner.length));
  for (const p of s) if (!pointInPoly(p, outer)) return false;
  return true;
}

/** Unit tangent at index i of a polyline (central difference; wraps when closed). */
export function tangentAt(poly: Pt[], i: number, closed: boolean): Pt {
  const n = poly.length;
  const prev = closed ? poly[(i - 1 + n) % n] : poly[Math.max(0, i - 1)];
  const next = closed ? poly[(i + 1) % n] : poly[Math.min(n - 1, i + 1)];
  return norm(sub(next, prev));
}

/**
 * Turn angle at index i, in radians. Positive == left turn.
 * Endpoints of an open polyline return 0.
 */
export function turnAt(poly: Pt[], i: number, closed: boolean): number {
  const n = poly.length;
  if (!closed && (i === 0 || i === n - 1)) return 0;
  const a = poly[(i - 1 + n) % n];
  const b = poly[i];
  const c = poly[(i + 1) % n];
  const u = norm(sub(b, a));
  const v = norm(sub(c, b));
  return Math.atan2(u.x * v.y - u.y * v.x, dot(u, v));
}

/** Drop consecutive duplicates below `eps`. */
export function dedupe(poly: Pt[], eps = 1e-9): Pt[] {
  const out: Pt[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > eps) out.push(p);
  }
  return out;
}
