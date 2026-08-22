import type { Pt } from '../types.ts';
import { angNorm } from './vec.ts';

export interface CenterArc {
  c: Pt;
  rx: number;
  ry: number;
  rot: number;
  /** Start angle, radians. */
  theta: number;
  /** Signed sweep, radians. */
  delta: number;
}

/** SVG endpoint arc parameterization -> center parameterization (W3C F.6.5). */
export function endpointToCenter(
  p0: Pt,
  rxIn: number,
  ryIn: number,
  rotDeg: number,
  large: boolean,
  sweep: boolean,
  p1: Pt,
): CenterArc | null {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return null;
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  const dx2 = (p0.x - p1.x) / 2;
  const dy2 = (p0.y - p1.y) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;

  // Scale radii up if they cannot span the endpoints (F.6.6).
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }

  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;

  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2;

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const theta = Math.atan2(uy, ux);
  let delta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  return { c: { x: cx, y: cy }, rx, ry, rot: phi, theta, delta };
}

export function centerArcAt(arc: CenterArc, t: number): Pt {
  const ang = arc.theta + arc.delta * t;
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);
  const cosP = Math.cos(arc.rot);
  const sinP = Math.sin(arc.rot);
  const x = arc.rx * cosA;
  const y = arc.ry * sinA;
  return { x: arc.c.x + cosP * x - sinP * y, y: arc.c.y + sinP * x + cosP * y };
}

/** Sample an arc densely enough that the chord sag stays under `tol`. */
export function flattenArc(arc: CenterArc, tol: number, out: Pt[]): void {
  const r = Math.max(arc.rx, arc.ry);
  // Sagitta of a chord subtending angle a on radius r is r*(1-cos(a/2)).
  const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(r, 1e-12))));
  const n = Math.max(2, Math.ceil(Math.abs(arc.delta) / Math.max(maxStep, 1e-3)));
  for (let i = 1; i <= n; i++) out.push(centerArcAt(arc, i / n));
}

/** Angular span of `ang` measured from `a0` going in direction `ccw`, in [0, 2PI). */
export function arcSpan(a0: number, ang: number, ccw: boolean): number {
  return ccw ? angNorm(ang - a0) : angNorm(a0 - ang);
}
