import type { ArcFit, Contour, CubicFit, Fit, LineFit, Pt } from '../types.ts';
import { angNorm, cross, dist, dot, len, norm, perp, sub } from '../geom/vec.ts';
import { angleOfPt, arcDir, isBezier, segEnd, segPt, segStart, segTangent, syncArcEnds, syncCubic } from '../geom/seg.ts';

/**
 * A tiny chain solver, so a contour can be edited by its geometry instead of by
 * its path data.
 *
 * Each segment owns intrinsic values — a line its two endpoints, an arc its
 * centre, radius and sweep — and neighbouring segments share a join point.
 * Change one radius and the join points no longer coincide. This re-derives
 * them: the edited segment is held fixed and the change propagates outwards,
 * each neighbour moved the least amount that reconnects it while keeping the
 * join's original character — a tangent join stays tangent, a corner stays a
 * corner.
 *
 * Scope: local repair, not a global constraint system. A closed contour is
 * over-determined, so the far side from the edit is where any leftover error
 * lands; `solveContour` returns that gap so a caller can reject an edit that
 * tore the chain open.
 */

export type JoinIntent = 'tangent' | 'corner';

export interface JoinSpec {
  intent: JoinIntent;
  /** Join point before the edit — picks the branch when a solve has two roots. */
  at: Pt;
}

/** Index of the segment after `i`, or -1 at the open end of a contour. */
const nextIdx = (i: number, n: number, closed: boolean): number => (i + 1 < n ? i + 1 : closed ? 0 : -1);

function joinAngle(f: Fit, g: Fit): number | null {
  const out = segTangent(f, 'end');
  const inc = segTangent(g, 'start');
  if (!out || !inc) return null;
  return Math.abs(Math.atan2(cross(out, inc), dot(out, inc)));
}

/**
 * Classify every join from the contour's current geometry.
 * Call this *before* applying an edit: afterwards the joins are broken, and a
 * broken join reads as a corner.
 */
export function captureJoins(c: Contour, g1Tol: number): JoinSpec[] {
  const n = c.segs.length;
  const out: JoinSpec[] = [];
  for (let i = 0; i < n; i++) {
    const j = nextIdx(i, n, c.closed);
    const at = segEnd(c.segs[i]) ?? { x: 0, y: 0 };
    if (j < 0) {
      out.push({ intent: 'corner', at }); // open end: never repaired
      continue;
    }
    const a = joinAngle(c.segs[i], c.segs[j]);
    out.push({ intent: a != null && a <= g1Tol ? 'tangent' : 'corner', at });
  }
  return out;
}

/**
 * Tangent point on circle (c, r) from the external point p, taking whichever of
 * the two solutions sits nearer `near` — the join point being replaced.
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

function setLineEnd(f: LineFit, end: 'start' | 'end', p: Pt): void {
  if (end === 'start') f.a = p;
  else f.b = p;
}

/**
 * Move an arc so one end lands on `P`, keeping its radius.
 * With `T` the required tangent there, the centre goes onto the normal at `P`;
 * without one it slides along the old centre direction, which keeps a corner's
 * angle as close to its old value as a fixed radius allows. The far end is
 * re-angled towards where it used to be, so the disturbance stays local rather
 * than swinging the whole arc around.
 */
function placeArcEnd(f: ArcFit, end: 'start' | 'end', P: Pt, T: Pt | null): void {
  const oldC = f.c;
  const far = segPt(f, end === 'start' ? 'end' : 'start') ?? oldC;
  const dir = arcDir(f);
  const sweepOld = f.a1 - f.a0;

  let c: Pt;
  if (T) {
    const n = perp(T);
    const c1 = { x: P.x + n.x * f.r, y: P.y + n.y * f.r };
    const c2 = { x: P.x - n.x * f.r, y: P.y - n.y * f.r };
    c = dist(c1, oldC) <= dist(c2, oldC) ? c1 : c2;
  } else {
    const u = norm(sub(oldC, P));
    if (u.x === 0 && u.y === 0) return;
    c = { x: P.x + u.x * f.r, y: P.y + u.y * f.r };
  }

  const aNear = angleOfPt(c, P);
  const aFar = angleOfPt(c, far);
  // Signed sweep from the moved end towards the far one, taken the short way
  // round the direction of travel.
  const span =
    end === 'start' ? dir * angNorm(dir * (aFar - aNear)) : dir * angNorm(dir * (aNear - aFar));
  // A far end that drifted past the centre flips that short way into nearly a
  // full turn. Keep the old sweep rather than emit the flip.
  const s = Math.abs(span - sweepOld) > Math.PI ? sweepOld : span;

  f.c = c;
  if (end === 'start') {
    f.a0 = aNear;
    f.a1 = aNear + s;
  } else {
    f.a1 = aNear;
    f.a0 = aNear - s;
  }
  syncArcEnds(f);
}

/**
 * Move one end of a cubic onto `P`, keeping the far end where it is.
 *
 * Pinning the far end is what makes editing next to a bezier stable: a bodily
 * translation would hand the displacement straight to the next join, so a
 * radius drag two segments away marches the whole contour across the canvas —
 * one step per pointer event. An authored bezier moves its endpoint and the
 * control leg attached to it; a raw sampled cubic spreads the displacement
 * along its arc length, full at the moved end and zero at the far one.
 */
export function placeCubicEnd(f: CubicFit, end: 'start' | 'end', P: Pt): void {
  const pts = f.pts;
  const cur = end === 'start' ? pts[0] : pts[pts.length - 1];
  if (!cur) return;
  const dx = P.x - cur.x;
  const dy = P.y - cur.y;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return;
  if (isBezier(f)) {
    if (end === 'start') {
      pts[0] = { x: P.x, y: P.y };
      f.c1 = { x: f.c1.x + dx, y: f.c1.y + dy };
    } else {
      pts[pts.length - 1] = { x: P.x, y: P.y };
      f.c2 = { x: f.c2.x + dx, y: f.c2.y + dy };
    }
    syncCubic(f);
    return;
  }
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (!(total > 0)) {
    for (const q of pts) {
      q.x += dx;
      q.y += dy;
    }
    return;
  }
  for (let i = 0; i < pts.length; i++) {
    const w = end === 'start' ? 1 - cum[i] / total : cum[i] / total;
    pts[i] = { x: pts[i].x + dx * w, y: pts[i].y + dy * w };
  }
}

/**
 * Move one end of `fol` onto `P`, with tangent `T` there when the join is
 * tangent. A line keeps its far endpoint and stretches; a tangent line instead
 * pivots about its far endpoint, since a line through a fixed point with a
 * fixed direction cannot also be tangent to anything.
 */
function placeEnd(fol: Fit, end: 'start' | 'end', P: Pt, T: Pt | null): void {
  switch (fol.kind) {
    case 'line': {
      if (!T) {
        setLineEnd(fol, end, P);
        return;
      }
      const l = len(sub(fol.b, fol.a)) || 1;
      if (end === 'start') {
        fol.a = P;
        fol.b = { x: P.x + T.x * l, y: P.y + T.y * l };
      } else {
        fol.b = P;
        fol.a = { x: P.x - T.x * l, y: P.y - T.y * l };
      }
      return;
    }
    case 'arc':
      placeArcEnd(fol, end, P, T);
      return;
    case 'cubic':
      placeCubicEnd(fol, end, P);
      return;
    default:
      return; // circles and ellipses are never links in a chain
  }
}

interface Step {
  join: number;
  /** Which side of the join moves: the one further from the edited segment. */
  follower: 'next' | 'prev';
}

/**
 * Joins ordered by distance from the edited segment, so every repair works
 * outwards from a side that is already settled.
 */
function solveOrder(n: number, closed: boolean, fixed: number): Step[] {
  const out: Step[] = [];
  if (closed) {
    const half = Math.floor(n / 2);
    for (let k = 0; k < half; k++) out.push({ join: (fixed + k) % n, follower: 'next' });
    for (let k = 1; k <= n - half; k++) out.push({ join: (((fixed - k) % n) + n) % n, follower: 'prev' });
  } else {
    for (let i = fixed; i < n - 1; i++) out.push({ join: i, follower: 'next' });
    for (let i = fixed - 1; i >= 0; i--) out.push({ join: i, follower: 'prev' });
  }
  return out;
}

function repairJoin(c: Contour, joins: JoinSpec[], step: Step): void {
  const n = c.segs.length;
  const j = nextIdx(step.join, n, c.closed);
  if (j < 0) return;
  const f = c.segs[step.join];
  const g = c.segs[j];
  const spec = joins[step.join];
  const auth = step.follower === 'next' ? f : g;
  const fol = step.follower === 'next' ? g : f;
  const authEnd: 'start' | 'end' = step.follower === 'next' ? 'end' : 'start';
  const folEnd: 'start' | 'end' = step.follower === 'next' ? 'start' : 'end';

  // Tangent line against an arc: the join point is itself unknown — it is the
  // tangent point from the line's far end, not wherever the arc happens to end.
  if (spec.intent === 'tangent' && fol.kind === 'line' && auth.kind === 'arc') {
    const far = folEnd === 'start' ? fol.b : fol.a;
    const T = tangentPoint(far, auth.c, auth.r, spec.at);
    if (T) {
      setLineEnd(fol, folEnd, T);
      // Re-angling the arc only shortens or lengthens its sweep; centre and
      // radius — the values the user edited — are untouched.
      const dir = arcDir(auth);
      const theta = angleOfPt(auth.c, T);
      if (authEnd === 'end') auth.a1 = auth.a0 + dir * angNorm(dir * (theta - auth.a0));
      else auth.a0 = auth.a1 - dir * angNorm(dir * (auth.a1 - theta));
      syncArcEnds(auth);
      spec.at = T;
      return;
    }
  }

  const P = segPt(auth, authEnd);
  if (!P) return;
  const T = spec.intent === 'tangent' ? segTangent(auth, authEnd) : null;
  placeEnd(fol, folEnd, P, T);
  spec.at = P;
}

/** Translate a line along its own normal until it sits `r` from `c`. */
function slideToRadius(line: LineFit, c: Pt, r: number): void {
  const d = norm(sub(line.b, line.a));
  const t = dot(sub(c, line.a), d);
  const foot = { x: line.a.x + d.x * t, y: line.a.y + d.y * t };
  const off = sub(c, foot);
  const l = Math.hypot(off.x, off.y);
  if (l < 1e-12) return;
  const shift = { x: (off.x / l) * (l - r), y: (off.y / l) * (l - r) };
  line.a = { x: line.a.x + shift.x, y: line.a.y + shift.y };
  line.b = { x: line.b.x + shift.x, y: line.b.y + shift.y };
}

/**
 * Re-place an arc after its radius changed, keeping tangent straight neighbours
 * exactly where they are.
 *
 * This is the fillet case, and it is the one that matters for a lettermark: a
 * stem is vertical because the designer made it vertical, so growing the corner
 * radius has to move the arc's centre and re-trim the stem — not pivot the stem
 * to chase the arc. Falls back to the generic repair (which moves the lines)
 * when the neighbours are not tangent lines, or when they are parallel and no
 * centre exists.
 */
export function refitArcRadius(c: Contour, idx: number, joins: JoinSpec[]): boolean {
  const n = c.segs.length;
  const f = c.segs[idx];
  if (f.kind !== 'arc') return false;

  const pi = idx > 0 ? idx - 1 : c.closed ? n - 1 : -1;
  const ni = nextIdx(idx, n, c.closed);
  const prev = pi >= 0 && joins[pi].intent === 'tangent' ? c.segs[pi] : null;
  const next = ni >= 0 && joins[idx].intent === 'tangent' ? c.segs[ni] : null;
  const l1 = prev && prev.kind === 'line' ? prev : null;
  const l2 = next && next.kind === 'line' ? next : null;
  if (!l1 && !l2) return false;

  // Distance from a point to a line is |cross(d, q - p)|; fixing the sign to the
  // side the old centre sits on turns "tangent at radius r" into one linear row.
  const row = (line: LineFit): { d: Pt; p: Pt; s: number } => {
    const d = norm(sub(line.b, line.a));
    const p = line.a;
    const s = Math.sign(cross(d, sub(f.c, p))) || 1;
    return { d, p, s };
  };

  let c2: Pt | null = null;
  if (l1 && l2) {
    const A = row(l1);
    const B = row(l2);
    const det = -A.d.y * B.d.x + A.d.x * B.d.y;
    // Treated as parallel well before the determinant vanishes: two sides a
    // fraction of a degree apart still put the fillet centre hundreds of units
    // away, and no artwork means a fillet between them.
    if (Math.abs(det) < 1e-2) {
      // Parallel sides — a stadium end. There is no centre that satisfies both
      // lines, so the sides move instead: each slides along its own normal to
      // sit r from the unmoved centre, which is what widening the end of a
      // rounded bar means. Their far ends then drag the rest of the contour,
      // and the generic repair picks that up.
      for (const line of [l1, l2]) slideToRadius(line, f.c, f.r);
      c2 = f.c;
    } else {
      const k1 = A.s * f.r + A.d.x * A.p.y - A.d.y * A.p.x;
      const k2 = B.s * f.r + B.d.x * B.p.y - B.d.y * B.p.x;
      // [-d1y  d1x][cx]   [k1]
      // [-d2y  d2x][cy] = [k2]
      c2 = { x: (B.d.x * k1 - A.d.x * k2) / det, y: (B.d.y * k1 - A.d.y * k2) / det };
    }
  } else {
    const A = row((l1 ?? l2) as LineFit);
    // Slide the centre along the line's normal, keeping the tangent point put.
    const t = dot(sub(f.c, A.p), A.d);
    const foot = { x: A.p.x + A.d.x * t, y: A.p.y + A.d.y * t };
    const nrm = perp(A.d);
    c2 = { x: foot.x + nrm.x * A.s * f.r, y: foot.y + nrm.y * A.s * f.r };
  }
  if (!c2 || !Number.isFinite(c2.x) || !Number.isFinite(c2.y)) return false;

  const dir = arcDir(f);
  const oldStart = segStart(f) as Pt;
  const oldEnd = segEnd(f) as Pt;
  f.c = c2;
  // Keep each end where it was in angle, then let the tangent feet below pin
  // whichever ends have a straight neighbour.
  f.a0 = angleOfPt(c2, oldStart);
  f.a1 = f.a0 + dir * angNorm(dir * (angleOfPt(c2, oldEnd) - f.a0));

  const trim = (line: LineFit, end: 'start' | 'end', arcEnd: 'start' | 'end'): void => {
    const d = norm(sub(line.b, line.a));
    const t = dot(sub(c2 as Pt, line.a), d);
    const foot = { x: line.a.x + d.x * t, y: line.a.y + d.y * t };
    setLineEnd(line, end, foot);
    const theta = angleOfPt(c2 as Pt, foot);
    if (arcEnd === 'start') f.a0 = f.a1 - dir * angNorm(dir * (f.a1 - theta));
    else f.a1 = f.a0 + dir * angNorm(dir * (theta - f.a0));
  };
  if (l1) trim(l1, 'end', 'start');
  if (l2) trim(l2, 'start', 'end');
  syncArcEnds(f);
  if (pi >= 0) joins[pi].at = segStart(f) as Pt;
  if (ni >= 0) joins[idx].at = segEnd(f) as Pt;
  return true;
}

/** Widest gap between segments that are supposed to share a join point. */
export function maxGap(c: Contour): number {
  const n = c.segs.length;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const j = nextIdx(i, n, c.closed);
    if (j < 0) continue;
    const a = segEnd(c.segs[i]);
    const b = segStart(c.segs[j]);
    if (a && b) worst = Math.max(worst, dist(a, b));
  }
  return worst;
}

/**
 * Reconnect a contour after `fixed` was edited.
 * Returns the widest gap left at any join — 0 for an open chain, and for a
 * closed one the price of the loop being over-determined: a closed chain of
 * tangent arcs cannot honour a new radius everywhere at once.
 */
export function solveContour(c: Contour, joins: JoinSpec[], fixed: number, passes = 4): number {
  const n = c.segs.length;
  if (n < 2) return 0;
  const order = solveOrder(n, c.closed, fixed);
  if (!order.length) return 0;
  // Repairing a join moves an endpoint the next repair depends on, so the chain
  // settles over a few sweeps rather than resolving in one.
  for (let p = 0; p < passes; p++) for (const step of order) repairJoin(c, joins, step);

  return maxGap(c);
}
