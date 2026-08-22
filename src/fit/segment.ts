import type { Fit, Pt } from '../types.ts';
import { cumLength, densify } from '../geom/poly.ts';
import { dist, dot, norm, sub } from '../geom/vec.ts';
import { fitArc, fitLine, rawFallback } from './primitives.ts';

export interface SegmentOptions {
  tol: number;
  lambdaPrims: number;
  lambdaParams: number;
  /** Corner threshold in radians. */
  cornerAngle?: number;
}

/**
 * Corner indices: vertices where the tangent turns sharply over a small
 * arclength window. Smooth curvature changes are deliberately NOT corners —
 * those are found later by the split-and-merge fitter.
 */
export function detectCorners(poly: Pt[], closed: boolean, tol: number, cornerAngle = Math.PI / 9): number[] {
  const n = poly.length;
  if (n < 4) return [];
  const cum = cumLength(poly);
  const total = cum[n - 1];
  if (total <= 0) return [];
  // Window long enough to be immune to sampling noise, short enough to localise.
  const win = Math.max(total * 0.01, tol * 4);

  const tangentBack = (i: number): Pt | null => {
    let j = i;
    while (j > 0 && cum[i] - cum[j] < win) j--;
    if (closed && cum[i] - cum[j] < win) {
      let k = n - 1;
      let acc = cum[i];
      while (k > 0 && acc < win) {
        acc += cum[k] - cum[k - 1];
        k--;
      }
      return norm(sub(poly[i], poly[k]));
    }
    if (j === i) return null;
    return norm(sub(poly[i], poly[j]));
  };
  const tangentFwd = (i: number): Pt | null => {
    let j = i;
    while (j < n - 1 && cum[j] - cum[i] < win) j++;
    if (closed && cum[j] - cum[i] < win) {
      let k = 0;
      let acc = total - cum[i];
      while (k < n - 1 && acc < win) {
        acc += cum[k + 1] - cum[k];
        k++;
      }
      return norm(sub(poly[k], poly[i]));
    }
    if (j === i) return null;
    return norm(sub(poly[j], poly[i]));
  };

  const raw: { i: number; ang: number }[] = [];
  const lo = closed ? 0 : 1;
  const hi = closed ? n - 1 : n - 1;
  for (let i = lo; i < hi; i++) {
    const b = tangentBack(i);
    const f = tangentFwd(i);
    if (!b || !f) continue;
    const ang = Math.abs(Math.atan2(b.x * f.y - b.y * f.x, dot(b, f)));
    if (ang > cornerAngle) raw.push({ i, ang });
  }

  // Non-maximum suppression: a real corner shows up on several adjacent samples.
  const out: number[] = [];
  let k = 0;
  while (k < raw.length) {
    let best = k;
    let j = k + 1;
    while (j < raw.length && raw[j].i - raw[j - 1].i <= 2) {
      if (raw[j].ang > raw[best].ang) best = j;
      j++;
    }
    out.push(raw[best].i);
    k = j;
  }
  return out;
}

/** Cost of a fit under minimum-description-length: error + complexity. */
export function mdlCost(f: Fit, tol: number, o: SegmentOptions): number {
  const err = f.maxDev / Math.max(tol, 1e-12);
  return err + o.lambdaPrims + o.lambdaParams * f.params;
}

/** Best primitive for one run of samples, or null when nothing fits inside tol. */
export function fitRun(pts: Pt[], o: SegmentOptions): Fit | null {
  if (pts.length < 2) return null;
  const cands: Fit[] = [];

  const line = fitLine(pts);
  if (line && line.maxDev <= o.tol) cands.push(line);

  // Only try an arc when the run is not already straight — fitting a circle to
  // near-collinear points produces an enormous unstable radius.
  if (pts.length >= 4 && (!line || line.maxDev > o.tol * 0.35)) {
    const arc = fitArc(pts);
    if (arc && arc.maxDev <= o.tol) {
      const chord = dist(pts[0], pts[pts.length - 1]);
      // Reject absurd radii: those are numerically straight lines in disguise.
      if (arc.r < chord * 5000) cands.push(arc);
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => mdlCost(a, o.tol, o) - mdlCost(b, o.tol, o));
  return cands[0];
}

interface Piece {
  fit: Fit;
  pts: Pt[];
}

/** Recursive split at the point of worst deviation until every run fits. */
function splitFit(pts: Pt[], o: SegmentOptions, depth = 0): Piece[] {
  const fit = fitRun(pts, o);
  if (fit) return [{ fit, pts }];
  if (pts.length <= 3 || depth > 20) return [{ fit: rawFallback(pts), pts }];

  // Split where a straight chord deviates most — a good proxy for where the
  // shape stops being one primitive.
  const a = pts[0];
  const b = pts[pts.length - 1];
  const d = norm(sub(b, a));
  const nvec = { x: -d.y, y: d.x };
  let bestI = Math.floor(pts.length / 2);
  let bestD = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const dev = Math.abs(dot(sub(pts[i], a), nvec));
    if (dev > bestD) {
      bestD = dev;
      bestI = i;
    }
  }
  if (bestI < 1) bestI = 1;
  if (bestI > pts.length - 2) bestI = pts.length - 2;
  return [...splitFit(pts.slice(0, bestI + 1), o, depth + 1), ...splitFit(pts.slice(bestI), o, depth + 1)];
}

/** Merge neighbours when one primitive explains both and MDL improves. */
function mergePass(runs: Pt[][], fits: Fit[], o: SegmentOptions): { runs: Pt[][]; fits: Fit[] } {
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let i = 0; i + 1 < runs.length; i++) {
      const joined = [...runs[i], ...runs[i + 1].slice(1)];
      const merged = fitRun(joined, o);
      if (!merged) continue;
      const before = mdlCost(fits[i], o.tol, o) + mdlCost(fits[i + 1], o.tol, o);
      if (mdlCost(merged, o.tol, o) < before) {
        runs.splice(i, 2, joined);
        fits.splice(i, 2, merged);
        changed = true;
        break;
      }
    }
  }
  return { runs, fits };
}

/**
 * Segment a polyline into fitted primitives.
 * Corner pre-split -> recursive split -> greedy merge.
 */
export function segmentPolyline(polyIn: Pt[], closed: boolean, o: SegmentOptions): Fit[] {
  // Densify rather than resample: corners must survive intact, and deviation
  // stats need samples along straight runs too.
  const perim = cumLength(polyIn)[polyIn.length - 1] ?? 0;
  const poly = perim > 0 ? densify(polyIn, perim / 240) : polyIn.slice();
  if (poly.length < 3) return [rawFallback(polyIn)];

  const corners = detectCorners(poly, closed, o.tol, o.cornerAngle);

  let runs: Pt[][] = [];
  if (!corners.length) {
    runs = [poly];
  } else if (closed) {
    // Rotate so the contour starts at a corner, then cut at the rest.
    const base = poly.slice(0, poly.length - 1); // drop the duplicated closing point
    const m = base.length;
    const start = corners[0] % m;
    const rot = [...base.slice(start), ...base.slice(0, start), base[start]];
    const cuts = corners.map((c) => (c - start + m) % m).sort((a, b) => a - b);
    let prev = 0;
    for (const c of cuts) {
      if (c <= prev) continue;
      runs.push(rot.slice(prev, c + 1));
      prev = c;
    }
    runs.push(rot.slice(prev));
  } else {
    let prev = 0;
    for (const c of corners) {
      if (c <= prev || c >= poly.length - 1) continue;
      runs.push(poly.slice(prev, c + 1));
      prev = c;
    }
    runs.push(poly.slice(prev));
  }
  runs = runs.filter((r) => r.length >= 2);
  if (!runs.length) return [rawFallback(polyIn)];

  const pieces: Piece[] = [];
  for (const r of runs) pieces.push(...splitFit(r, o));

  const { fits } = mergePass(
    pieces.map((p) => p.pts),
    pieces.map((p) => p.fit),
    o,
  );
  return fits;
}
