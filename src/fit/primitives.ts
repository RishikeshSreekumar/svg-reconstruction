import type { ArcFit, CircleFit, CubicFit, EllipseFit, Fit, LineFit, Pt } from '../types.ts';
import { angDiff, angNorm, dist, dot, norm, sub } from '../geom/vec.ts';
import { symEigen } from '../geom/linalg.ts';

// ---------------------------------------------------------------------------
// Line — total least squares (PCA), so vertical lines are not special-cased.
// ---------------------------------------------------------------------------

export function fitLine(pts: Pt[]): LineFit | null {
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  // Principal direction = eigenvector of the largest eigenvalue of [[sxx,sxy],[sxy,syy]].
  const tr = sxx + syy;
  const dsc = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) + 4 * sxy * sxy));
  const l1 = (tr + dsc) / 2;
  let dir: Pt = Math.abs(sxy) > 1e-18 ? norm({ x: sxy, y: l1 - sxx }) : sxx >= syy ? { x: 1, y: 0 } : { x: 0, y: 1 };
  if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 };

  // Project the samples onto the axis to get the endpoints, so the segment
  // spans exactly what the source spanned.
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const p of pts) {
    const t = dot(sub(p, { x: mx, y: my }), dir);
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  // Endpoints anchored to the actual first/last sample projections keeps
  // chained segments meeting where the source met.
  const proj = (p: Pt): Pt => {
    const t = dot(sub(p, { x: mx, y: my }), dir);
    return { x: mx + dir.x * t, y: my + dir.y * t };
  };
  const a = proj(pts[0]);
  const b = proj(pts[n - 1]);

  let maxDev = 0;
  let sum2 = 0;
  const nrm = { x: -dir.y, y: dir.x };
  for (const p of pts) {
    const d = Math.abs(dot(sub(p, { x: mx, y: my }), nrm));
    if (d > maxDev) maxDev = d;
    sum2 += d * d;
  }
  return { kind: 'line', a, b, maxDev, rmsDev: Math.sqrt(sum2 / n), params: 4 };
}

// ---------------------------------------------------------------------------
// Circle — Taubin algebraic fit, then one Gauss-Newton geometric refinement.
// Naive least squares is biased on short arcs; Taubin is not.
// ---------------------------------------------------------------------------

export interface RawCircle {
  c: Pt;
  r: number;
}

export function taubinCircle(pts: Pt[]): RawCircle | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  let Mxx = 0;
  let Myy = 0;
  let Mxy = 0;
  let Mxz = 0;
  let Myz = 0;
  let Mzz = 0;
  for (const p of pts) {
    const x = p.x - mx;
    const y = p.y - my;
    const z = x * x + y * y;
    Mxx += x * x;
    Myy += y * y;
    Mxy += x * y;
    Mxz += x * z;
    Myz += y * z;
    Mzz += z * z;
  }
  Mxx /= n;
  Myy /= n;
  Mxy /= n;
  Mxz /= n;
  Myz /= n;
  Mzz /= n;

  const Mz = Mxx + Myy;
  const covXY = Mxx * Myy - Mxy * Mxy;
  const varZ = Mzz - Mz * Mz;

  const A3 = 4 * Mz;
  const A2 = -3 * Mz * Mz - Mzz;
  const A1 = varZ * Mz + 4 * covXY * Mz - Mxz * Mxz - Myz * Myz;
  const A0 = Mxz * (Mxz * Myy - Myz * Mxy) + Myz * (Myz * Mxx - Mxz * Mxy) - varZ * covXY;
  const A22 = A2 + A2;
  const A33 = A3 + A3 + A3;

  // Newton from x=0 converges to the smallest positive root for Taubin.
  let x = 0;
  let y = A0;
  for (let i = 0; i < 60; i++) {
    const dy = A1 + x * (A22 + x * A33);
    if (Math.abs(dy) < 1e-18) break;
    const xNew = x - y / dy;
    if (!Number.isFinite(xNew) || xNew === x) break;
    const yNew = A0 + xNew * (A1 + xNew * (A2 + xNew * A3));
    if (Math.abs(yNew) >= Math.abs(y)) {
      x = xNew;
      break;
    }
    x = xNew;
    y = yNew;
  }

  const det = x * x - x * Mz + covXY;
  if (Math.abs(det) < 1e-18) return null; // degenerate: samples are collinear
  const cx = (Mxz * (Myy - x) - Myz * Mxy) / det / 2;
  const cy = (Myz * (Mxx - x) - Mxz * Mxy) / det / 2;
  const r = Math.sqrt(cx * cx + cy * cy + Mz);
  if (!Number.isFinite(r) || r <= 0) return null;
  return { c: { x: cx + mx, y: cy + my }, r };
}

/** Gauss-Newton refinement minimising true geometric distance. */
export function refineCircle(pts: Pt[], init: RawCircle, iters = 8): RawCircle {
  let { c, r } = init;
  for (let it = 0; it < iters; it++) {
    // Normal equations for residual f_i = |p_i - c| - r wrt (cx, cy, r).
    let j00 = 0;
    let j01 = 0;
    let j02 = 0;
    let j11 = 0;
    let j12 = 0;
    let j22 = 0;
    let g0 = 0;
    let g1 = 0;
    let g2 = 0;
    for (const p of pts) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-15) continue;
      const a0 = -dx / d;
      const a1 = -dy / d;
      const a2 = -1;
      const res = d - r;
      j00 += a0 * a0;
      j01 += a0 * a1;
      j02 += a0 * a2;
      j11 += a1 * a1;
      j12 += a1 * a2;
      j22 += a2 * a2;
      g0 += a0 * res;
      g1 += a1 * res;
      g2 += a2 * res;
    }
    const M = [
      [j00, j01, j02],
      [j01, j11, j12],
      [j02, j12, j22],
    ];
    const step = solve3(M, [-g0, -g1, -g2]);
    if (!step) break;
    c = { x: c.x + step[0], y: c.y + step[1] };
    r += step[2];
    if (Math.hypot(step[0], step[1], step[2]) < 1e-12) break;
  }
  return { c, r: Math.abs(r) };
}

function solve3(M: number[][], b: number[]): number[] | null {
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-16) return null;
  const inv = (r: number, c: number): number => {
    const r1 = (r + 1) % 3;
    const r2 = (r + 2) % 3;
    const c1 = (c + 1) % 3;
    const c2 = (c + 2) % 3;
    return (M[c1][r1] * M[c2][r2] - M[c1][r2] * M[c2][r1]) / det;
  };
  return [0, 1, 2].map((i) => inv(i, 0) * b[0] + inv(i, 1) * b[1] + inv(i, 2) * b[2]);
}

export function circleDeviation(pts: Pt[], c: Pt, r: number): { maxDev: number; rmsDev: number } {
  let maxDev = 0;
  let sum2 = 0;
  for (const p of pts) {
    const d = Math.abs(dist(p, c) - r);
    if (d > maxDev) maxDev = d;
    sum2 += d * d;
  }
  return { maxDev, rmsDev: Math.sqrt(sum2 / Math.max(1, pts.length)) };
}

/** Fit a full circle (used for closed contours). */
export function fitCircle(pts: Pt[]): CircleFit | null {
  const raw = taubinCircle(pts);
  if (!raw) return null;
  const ref = refineCircle(pts, raw);
  const dev = circleDeviation(pts, ref.c, ref.r);
  return { kind: 'circle', c: ref.c, r: ref.r, ...dev, params: 3 };
}

/**
 * Fit a circular arc through an open run of samples.
 * Rejects runs that wrap more than once or that are effectively straight.
 */
export function fitArc(pts: Pt[]): ArcFit | null {
  if (pts.length < 3) return null;
  const raw = taubinCircle(pts);
  if (!raw) return null;
  const ref = refineCircle(pts, raw);
  if (!Number.isFinite(ref.r) || ref.r <= 0) return null;

  const angs = pts.map((p) => Math.atan2(p.y - ref.c.y, p.x - ref.c.x));

  // Unwrap to get a monotone sweep; a non-monotone sweep means these samples
  // are not a single arc.
  let total = 0;
  let flips = 0;
  let prevSign = 0;
  for (let i = 1; i < angs.length; i++) {
    const d = angDiff(angs[i], angs[i - 1]);
    if (Math.abs(d) > Math.PI * 0.75) return null; // sampling too sparse to trust
    total += d;
    const s = Math.sign(d);
    if (s !== 0) {
      if (prevSign !== 0 && s !== prevSign) flips++;
      prevSign = s;
    }
  }
  if (flips > pts.length * 0.15) return null; // wobbles back and forth: not an arc
  if (Math.abs(total) > Math.PI * 2 + 1e-6) return null;
  if (Math.abs(total) < 1e-6) return null;

  const dev = circleDeviation(pts, ref.c, ref.r);
  return {
    kind: 'arc',
    c: ref.c,
    r: ref.r,
    a0: angs[0],
    a1: angs[0] + total,
    ccw: total > 0,
    a: pts[0],
    b: pts[pts.length - 1],
    ...dev,
    params: 5,
  };
}

// ---------------------------------------------------------------------------
// Ellipse — direct algebraic conic fit (smallest eigenvector of the scatter
// matrix), then geometric deviation measured by Newton projection.
// ---------------------------------------------------------------------------

export function fitEllipse(pts: Pt[]): EllipseFit | null {
  const n = pts.length;
  if (n < 6) return null;

  // Normalize for conditioning.
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let s = 0;
  for (const p of pts) s = Math.max(s, Math.abs(p.x - mx), Math.abs(p.y - my));
  if (s < 1e-12) return null;

  const D: number[][] = pts.map((p) => {
    const x = (p.x - mx) / s;
    const y = (p.y - my) / s;
    return [x * x, x * y, y * y, x, y, 1];
  });
  const S: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (const row of D) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) S[i][j] += row[i] * row[j];
  }
  const { vectors } = symEigen(S);
  const v = vectors[0]; // smallest eigenvalue => best algebraic fit under ||v||=1
  const [A, B, C, Dc, E, F] = v;

  const disc = B * B - 4 * A * C;
  if (disc >= -1e-12) return null; // not an ellipse

  const cx = (2 * C * Dc - B * E) / disc;
  const cy = (2 * A * E - B * Dc) / disc;

  // Translating to the centre kills the linear terms:
  //   Q(x) = (x-c)^T M (x-c) + Q(c),  M = [[A, B/2], [B/2, C]]
  // so the axes are M's eigenvectors and the semi-axis along v_i is
  // sqrt(-Q(c)/lambda_i). Deriving them this way avoids the atan2 sign
  // conventions that silently swap major and minor.
  const qc = A * cx * cx + B * cx * cy + C * cy * cy + Dc * cx + E * cy + F;
  let k = -qc;
  let m11 = A;
  let m12 = B / 2;
  let m22 = C;
  // The eigenvector has an arbitrary overall sign, and negating the whole conic
  // negates M as well — which swaps which eigenvalue is the smaller one, and so
  // swaps major and minor. Pin the sign so M is positive definite.
  if (k < 0) {
    k = -k;
    m11 = -m11;
    m12 = -m12;
    m22 = -m22;
  }
  const tr = m11 + m22;
  const dsc = Math.sqrt(Math.max(0, (m11 - m22) * (m11 - m22) + 4 * m12 * m12));
  const lamMin = (tr - dsc) / 2;
  const lamMax = (tr + dsc) / 2;
  if (lamMin <= 0 || lamMax <= 0) return null;
  const axMajor = Math.sqrt(k / lamMin);
  const axMinor = Math.sqrt(k / lamMax);
  if (!Number.isFinite(axMajor) || !Number.isFinite(axMinor) || axMajor <= 0 || axMinor <= 0) return null;

  // Eigenvector for lamMin: the major axis direction.
  let vx: number;
  let vy: number;
  if (Math.abs(m12) > 1e-18) {
    vx = lamMin - m22;
    vy = m12;
  } else {
    // Diagonal form: the major axis is whichever coordinate axis has the
    // smaller coefficient.
    vx = m11 <= m22 ? 1 : 0;
    vy = m11 <= m22 ? 0 : 1;
  }
  const vlen = Math.hypot(vx, vy) || 1;
  const rot = Math.atan2(vy / vlen, vx / vlen);

  const c = { x: cx * s + mx, y: cy * s + my };
  const rx = axMajor * s;
  const ry = axMinor * s;

  const dev = ellipseDeviation(pts, c, rx, ry, rot);
  return { kind: 'ellipse', c, rx, ry, rot, ...dev, params: 5 };
}

/** Geometric deviation from an ellipse, via Newton on the parametric angle. */
export function ellipseDeviation(
  pts: Pt[],
  c: Pt,
  rx: number,
  ry: number,
  rot: number,
): { maxDev: number; rmsDev: number } {
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  let maxDev = 0;
  let sum2 = 0;
  for (const p of pts) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const x = cosR * dx + sinR * dy;
    const y = -sinR * dx + cosR * dy;
    let t = Math.atan2(y / Math.max(ry, 1e-12), x / Math.max(rx, 1e-12));
    for (let i = 0; i < 12; i++) {
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const ex = rx * ct;
      const ey = ry * st;
      const dxe = -rx * st;
      const dye = ry * ct;
      const f = (x - ex) * dxe + (y - ey) * dye;
      const fp = (x - ex) * -rx * ct + dxe * -dxe + (y - ey) * -ry * st + dye * -dye;
      if (Math.abs(fp) < 1e-18) break;
      const step = f / fp;
      t -= step;
      if (Math.abs(step) < 1e-12) break;
    }
    const d = Math.hypot(x - rx * Math.cos(t), y - ry * Math.sin(t));
    if (d > maxDev) maxDev = d;
    sum2 += d * d;
  }
  return { maxDev, rmsDev: Math.sqrt(sum2 / Math.max(1, pts.length)) };
}

export function rawFallback(pts: Pt[]): CubicFit {
  return { kind: 'cubic', pts: pts.slice(), maxDev: 0, rmsDev: 0, params: pts.length * 2 };
}

/** Sample a fitted primitive back into a polyline, for verification. */
export function sampleFit(f: Fit, n = 64): Pt[] {
  switch (f.kind) {
    case 'line':
      return [f.a, f.b];
    case 'cubic':
      return f.pts;
    case 'circle': {
      const out: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push({ x: f.c.x + f.r * Math.cos(a), y: f.c.y + f.r * Math.sin(a) });
      }
      return out;
    }
    case 'ellipse': {
      const out: Pt[] = [];
      const cosR = Math.cos(f.rot);
      const sinR = Math.sin(f.rot);
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = f.rx * Math.cos(a);
        const y = f.ry * Math.sin(a);
        out.push({ x: f.c.x + cosR * x - sinR * y, y: f.c.y + sinR * x + cosR * y });
      }
      return out;
    }
    case 'arc': {
      const out: Pt[] = [];
      const span = f.a1 - f.a0;
      const steps = Math.max(4, Math.ceil((Math.abs(span) / (Math.PI * 2)) * n));
      for (let i = 0; i <= steps; i++) {
        const a = f.a0 + (span * i) / steps;
        out.push({ x: f.c.x + f.r * Math.cos(a), y: f.c.y + f.r * Math.sin(a) });
      }
      return out;
    }
  }
}

export const angleOf = (c: Pt, p: Pt): number => angNorm(Math.atan2(p.y - c.y, p.x - c.x));
