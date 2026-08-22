import type { Pt } from '../types.ts';
import { ptSegDist } from './vec.ts';

export function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

export function cubicDerivAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

export function quadToCubic(p0: Pt, c: Pt, p1: Pt): [Pt, Pt] {
  return [
    { x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) },
    { x: p1.x + (2 / 3) * (c.x - p1.x), y: p1.y + (2 / 3) * (c.y - p1.y) },
  ];
}

/**
 * Adaptive flatten by recursive subdivision on flatness.
 * Appends to `out` WITHOUT the start point (caller owns it) and includes p3.
 */
export function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, out: Pt[], depth = 0): void {
  // Flatness test: control points' distance to the chord.
  const d1 = ptSegDist(p1, p0, p3);
  const d2 = ptSegDist(p2, p0, p3);
  if (depth > 24 || (d1 <= tol && d2 <= tol)) {
    out.push(p3);
    return;
  }
  // de Casteljau split at t = 0.5
  const p01 = mid2(p0, p1);
  const p12 = mid2(p1, p2);
  const p23 = mid2(p2, p3);
  const p012 = mid2(p01, p12);
  const p123 = mid2(p12, p23);
  const m = mid2(p012, p123);
  flattenCubic(p0, p01, p012, m, tol, out, depth + 1);
  flattenCubic(m, p123, p23, p3, tol, out, depth + 1);
}

const mid2 = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
