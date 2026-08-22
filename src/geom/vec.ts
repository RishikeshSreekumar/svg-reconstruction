import type { Pt } from '../types.ts';

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Pt, b: Pt): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function norm(a: Pt): Pt {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left normal (90deg CCW in math space, CW on screen). */
export const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });

export const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Smallest signed difference between two angles, in (-PI, PI]. */
export function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Normalize angle into [0, 2PI). */
export function angNorm(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

export function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

/** Distance from p to the segment ab, plus the closest point. */
export function ptSegDist(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  let t = dot(sub(p, a), ab) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}
