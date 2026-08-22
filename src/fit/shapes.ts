import type { ArcFit, Fit, LineFit, Pt } from '../types.ts';
import { dist, dot, len, norm, sub } from '../geom/vec.ts';
import { densify, hausdorff, totalLength } from '../geom/poly.ts';
import { circleDeviation, ellipseDeviation, fitCircle, fitEllipse } from './primitives.ts';

export type ShapeGuess =
  | { kind: 'circle'; c: Pt; r: number; maxDev: number; params: number }
  | { kind: 'ellipse'; c: Pt; rx: number; ry: number; rot: number; maxDev: number; params: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number; rot: number; maxDev: number; params: number }
  | { kind: 'polygon'; pts: Pt[]; sides: number; c: Pt; r: number; rot: number; maxDev: number; params: number };

/** Intersection of two infinite lines through (a,dirA) and (b,dirB). */
function lineIsect(a: Pt, da: Pt, b: Pt, db: Pt): Pt | null {
  const denom = da.x * db.y - da.y * db.x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / denom;
  return { x: a.x + da.x * t, y: a.y + da.y * t };
}

function samplePolygon(pts: Pt[]): Pt[] {
  return [...pts, pts[0]];
}

function sampleRect(x: number, y: number, w: number, h: number, rx: number, rot: number, n = 16): Pt[] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const to = (p: Pt): Pt => ({ x: x + cos * p.x - sin * p.y, y: y + sin * p.x + cos * p.y });
  const out: Pt[] = [];
  if (rx <= 0) {
    for (const p of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]) out.push(to(p));
    out.push(out[0]);
    return out;
  }
  const r = Math.min(rx, w / 2, h / 2);
  const corners: [Pt, number][] = [
    [{ x: w - r, y: r }, -Math.PI / 2],
    [{ x: w - r, y: h - r }, 0],
    [{ x: r, y: h - r }, Math.PI / 2],
    [{ x: r, y: r }, Math.PI],
  ];
  for (const [c, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (Math.PI / 2) * (i / n);
      out.push(to({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }));
    }
  }
  out.push(out[0]);
  return out;
}

/**
 * Try to recognise a whole closed contour as a single named shape.
 * Every candidate is verified by re-sampling and comparing with Hausdorff —
 * an algebraic fit that "succeeded" numerically can still be visually wrong.
 */
export function recognizeClosed(polyIn: Pt[], fits: Fit[], tol: number): ShapeGuess | null {
  // Densify here rather than trusting callers: a contour carrying only its
  // corner vertices lets a circle fit a triangle or a square exactly.
  const perim = totalLength(polyIn);
  const poly = perim > 0 ? densify(polyIn, Math.max(perim / 240, tol / 4)) : polyIn;
  const cands: ShapeGuess[] = [];

  const circle = fitCircle(poly);
  if (circle && circle.maxDev <= tol) {
    cands.push({ kind: 'circle', c: circle.c, r: circle.r, maxDev: circle.maxDev, params: 3 });
  }

  // Only bother with an ellipse when a circle did not already explain it.
  if (!cands.length) {
    const ell = fitEllipse(poly);
    if (ell && ell.maxDev <= tol && Math.min(ell.rx, ell.ry) > tol) {
      cands.push({ kind: 'ellipse', c: ell.c, rx: ell.rx, ry: ell.ry, rot: ell.rot, maxDev: ell.maxDev, params: 5 });
    }
  }

  const rect = tryRect(poly, fits, tol);
  if (rect) cands.push(rect);

  // A square satisfies both rect and 4-gon. Rect is what authors write, and it
  // is the only one of the two that survives a non-uniform edit.
  const poly2 = rect ? null : tryRegularPolygon(poly, fits, tol);
  if (poly2) cands.push(poly2);

  if (!cands.length) return null;
  // Fewest parameters wins; deviation breaks ties.
  cands.sort((a, b) => a.params - b.params || a.maxDev - b.maxDev);
  return cands[0];
}

function isLine(f: Fit): f is LineFit {
  return f.kind === 'line';
}
function isArc(f: Fit): f is ArcFit {
  return f.kind === 'arc';
}

/** Rect and rounded-rect from 4 lines, or 4 lines alternating with 4 equal arcs. */
export function tryRect(poly: Pt[], fits: Fit[], tol: number): ShapeGuess | null {
  const lines = fits.filter(isLine);
  const arcs = fits.filter(isArc);

  let cornerR = 0;
  if (fits.length === 4 && lines.length === 4) {
    cornerR = 0;
  } else if (fits.length === 8 && lines.length === 4 && arcs.length === 4) {
    const rs = arcs.map((a) => a.r);
    const mean = rs.reduce((a, b) => a + b, 0) / 4;
    if (rs.some((r) => Math.abs(r - mean) > Math.max(tol, mean * 0.05))) return null;
    cornerR = mean;
  } else {
    return null;
  }

  // Order the four side directions and check the right-angle structure.
  const dirs = lines.map((l) => norm(sub(l.b, l.a)));
  const base = dirs[0];
  const nrm = { x: -base.y, y: base.x };
  for (const d of dirs) {
    const alongAbs = Math.abs(dot(d, base));
    const perpAbs = Math.abs(dot(d, nrm));
    if (Math.min(alongAbs, perpAbs) > 0.06) return null; // not axis-parallel to side 0
  }

  const alongs = lines.filter((l) => Math.abs(dot(norm(sub(l.b, l.a)), base)) > 0.7);
  const perps = lines.filter((l) => Math.abs(dot(norm(sub(l.b, l.a)), nrm)) > 0.7);
  if (alongs.length !== 2 || perps.length !== 2) return null;

  const corners: Pt[] = [];
  for (const a of alongs) {
    for (const p of perps) {
      const hit = lineIsect(a.a, norm(sub(a.b, a.a)), p.a, norm(sub(p.b, p.a)));
      if (hit) corners.push(hit);
    }
  }
  if (corners.length !== 4) return null;

  // Local frame: u along base, v perpendicular.
  const u = base;
  const v = nrm;
  const us = corners.map((c) => dot(c, u));
  const vs = corners.map((c) => dot(c, v));
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  const w = u1 - u0;
  const h = v1 - v0;
  if (w <= tol || h <= tol) return null;

  const origin: Pt = { x: u.x * u0 + v.x * v0, y: u.y * u0 + v.y * v0 };
  const rot = Math.atan2(u.y, u.x);
  const dev = hausdorff(sampleRect(origin.x, origin.y, w, h, cornerR, rot), poly);
  if (dev > tol) return null;

  return {
    kind: 'rect',
    x: origin.x,
    y: origin.y,
    w,
    h,
    rx: cornerR,
    rot,
    maxDev: dev,
    params: cornerR > 0 ? 6 : 5,
  };
}

/** Equilateral, equiangular polygon with 3..12 sides. */
export function tryRegularPolygon(poly: Pt[], fits: Fit[], tol: number): ShapeGuess | null {
  const n = fits.length;
  if (n < 3 || n > 12) return null;
  if (!fits.every(isLine)) return null;
  const lines = fits as LineFit[];

  const verts: Pt[] = lines.map((l) => l.a);
  const lens = lines.map((l) => dist(l.a, l.b));
  const meanLen = lens.reduce((a, b) => a + b, 0) / n;
  if (meanLen <= tol) return null;
  if (lens.some((L) => Math.abs(L - meanLen) > Math.max(tol * 2, meanLen * 0.04))) return null;

  const c: Pt = {
    x: verts.reduce((s, p) => s + p.x, 0) / n,
    y: verts.reduce((s, p) => s + p.y, 0) / n,
  };
  const radii = verts.map((p) => dist(p, c));
  const meanR = radii.reduce((a, b) => a + b, 0) / n;
  if (radii.some((r) => Math.abs(r - meanR) > Math.max(tol * 2, meanR * 0.03))) return null;

  const rot = Math.atan2(verts[0].y - c.y, verts[0].x - c.x);
  const ideal: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (2 * Math.PI * i) / n;
    ideal.push({ x: c.x + meanR * Math.cos(a), y: c.y + meanR * Math.sin(a) });
  }
  // Regenerating from (c, r, rot, n) must reproduce the source, in order.
  let dev = hausdorff(samplePolygon(ideal), poly);
  if (dev > tol) {
    // The vertex order may run the other way.
    const flipped = [ideal[0], ...ideal.slice(1).reverse()];
    dev = hausdorff(samplePolygon(flipped), poly);
    if (dev > tol) return null;
  }
  return { kind: 'polygon', pts: ideal, sides: n, c, r: meanR, rot, maxDev: dev, params: 4 };
}

export { sampleRect, samplePolygon, lineIsect };

/** Deviation helpers re-exported so callers do not reach into primitives.ts. */
export { circleDeviation, ellipseDeviation };
export const vecLen = len;
