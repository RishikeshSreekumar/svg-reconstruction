import type { LineFit, Pt } from '../types.ts';
import { expandStroke, type Cap, type Join } from '../geom/offset.ts';
import { directedHausdorff, hausdorff, pointInPoly, resample, signedArea, totalLength } from '../geom/poly.ts';
import { add, dist, mid, mul, norm, perp, sub } from '../geom/vec.ts';
import { segmentPolyline } from '../fit/segment.ts';

export interface StrokeCandidate {
  centerline: Pt[];
  width: number;
  closed: boolean;
  cap: Cap;
  join: Join;
  /** Hausdorff between the re-expanded outline and the source outline(s). */
  maxDev: number;
  note: string;
}

/** First hit of a ray against a polyline, skipping hits closer than `minT`. */
function rayHit(o: Pt, d: Pt, poly: Pt[], minT: number): { t: number; p: Pt } | null {
  let best: { t: number; p: Pt } | null = null;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-14) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    if (t < minT) continue;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    if (!best || t < best.t) best = { t, p: { x: o.x + d.x * t, y: o.y + d.y * t } };
  }
  return best;
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Pick the normal at `p` that points into the filled interior. */
function inwardNormal(p: Pt, tangent: Pt, poly: Pt[], eps: number): Pt {
  const n = perp(tangent);
  return pointInPoly(add(p, mul(n, eps)), poly) ? n : mul(n, -1);
}

const CAPS: Cap[] = ['butt', 'round', 'square'];
const JOINS: Join[] = ['round', 'miter'];

/**
 * Straighten a raw centerline.
 *
 * Midpoint pairing rounds off every corner, because near a corner the two walls
 * are an arc on one side and a miter on the other. Fitting the centerline and
 * then intersecting adjacent straight runs puts the sharp corner back.
 */
function cleanCenterline(pts: Pt[], closed: boolean, tol: number): Pt[] {
  const fits = segmentPolyline(pts, closed, { tol, lambdaPrims: 1, lambdaParams: 0.25 });
  const all = fits.filter((f): f is LineFit => f.kind === 'line');
  if (all.length < 2 || all.length !== fits.length) return pts;

  // Dropping corner samples leaves a short chamfer bridging each corner.
  // Those stubs must go before intersecting, or the corner stays cut.
  const lens = all.map((l) => dist(l.a, l.b)).sort((x, y) => x - y);
  const medLen = lens[lens.length >> 1];
  const kept = all.filter((l) => dist(l.a, l.b) >= medLen * 0.25);
  const lines = kept.length >= (closed ? 3 : 2) ? kept : all;

  const dirOf = (l: LineFit): Pt => norm(sub(l.b, l.a));
  const last = lines.length - 1;
  for (let i = 0; i < (closed ? lines.length : last); i++) {
    const a = lines[i];
    const b = lines[(i + 1) % lines.length];
    const da = dirOf(a);
    const db = dirOf(b);
    // Near-parallel runs have no meaningful intersection to snap to.
    if (Math.abs(da.x * db.y - da.y * db.x) < 0.05) continue;
    const hit = lineIsect(a.a, da, b.a, db);
    if (!hit) continue;
    // Only trust the intersection when it sits near the junction it replaces.
    const gap = dist(a.b, b.a);
    if (dist(hit, a.b) > Math.max(gap * 4, tol * 8)) continue;
    a.b = hit;
    b.a = hit;
  }

  const out: Pt[] = [lines[0].a];
  for (const l of lines) out.push(l.b);
  if (closed && dist(out[0], out[out.length - 1]) > 1e-9) out.push({ ...out[0] });
  return out;
}

function lineIsect(a: Pt, da: Pt, b: Pt, db: Pt): Pt | null {
  const den = da.x * db.y - da.y * db.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / den;
  return { x: a.x + da.x * t, y: a.y + da.y * t };
}

/**
 * A single closed outline that is really an expanded open stroke.
 * Detected by measuring the local thickness across the shape and checking it
 * is constant, then verifying by re-expanding the recovered centerline.
 */
export function detectSelfStroke(outlineIn: Pt[], tol: number): StrokeCandidate | null {
  const N = 240;
  const outline = resample(outlineIn, Math.min(N, Math.max(48, outlineIn.length)));
  const n = outline.length;
  if (n < 12) return null;

  const perim = totalLength(outline);
  const eps = Math.max(perim * 1e-4, 1e-9);

  interface Sample {
    i: number;
    j: number;
    w: number;
    c: Pt;
  }
  const samples: Sample[] = [];
  for (let i = 0; i < n - 1; i++) {
    const t = norm(sub(outline[(i + 1) % (n - 1)], outline[(i - 1 + n - 1) % (n - 1)]));
    if (t.x === 0 && t.y === 0) continue;
    const nrm = inwardNormal(outline[i], t, outline, eps);
    const hit = rayHit(outline[i], nrm, outline, eps * 4);
    if (!hit) continue;
    // Which sample index did we land on? Used to separate the two walls.
    let j = 0;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const d = dist(hit.p, outline[k]);
      if (d < bestD) {
        bestD = d;
        j = k;
      }
    }
    samples.push({ i, j, w: hit.t, c: mid(outline[i], hit.p) });
  }
  if (samples.length < n * 0.5) return null;

  const width = medianOf(samples.map((s) => s.w));
  if (width <= tol * 2) return null;
  // A stroke has near-constant thickness. Allow a minority of outliers for caps
  // and joins, but the bulk must agree.
  const wTol = Math.max(tol * 2, width * 0.06);
  const good = samples.filter((s) => Math.abs(s.w - width) <= wTol);
  if (good.length < samples.length * 0.7) return null;

  // Walking the outline traverses wall A forwards and wall B backwards, so
  // i < j selects one wall and gives the centerline in order.
  const wallA = good.filter((s) => s.j > s.i).sort((a, b) => a.i - b.i);
  if (wallA.length < 8) return null;

  const centerRaw = dedupeClose(wallA.map((s) => s.c), width * 0.02);
  if (centerRaw.length < 4) return null;

  const candidates = [centerRaw, cleanCenterline(centerRaw, false, Math.max(tol, width * 0.05))];

  let best: StrokeCandidate | null = null;
  for (const centerline of candidates) {
    if (centerline.length < 2) continue;
    // How far each end falls short of the real tip, measured against the source
    // outline rather than guessed.
    const reach = [capReach(centerline, 'start', outline, eps), capReach(centerline, 'end', outline, eps)];
    for (const cap of CAPS) {
      for (const join of JOINS) {
        // A butt cap sits on the tip; round and square caps sit half a width
        // beyond it, so the same measurement means a shorter centerline.
        const back = cap === 'butt' ? 0 : width / 2;
        const opts = reach.map((t) => {
          const set = [0];
          if (t != null && t - back > 1e-9) set.push(t - back);
          return set;
        });
        for (const ds of opts[0]) {
          for (const de of opts[1]) {
            const cl = ds > 0 || de > 0 ? extendEnds(centerline, ds, de) : centerline;
            const loops = expandStroke(cl, width, false, cap, join);
            if (!loops.length) continue;
            // Verify against the source at full resolution. `outline` is
            // resampled for the thickness scan, and resampling cuts corners —
            // measuring a cap against a chord that skipped the corner reads as
            // an error the reconstruction does not have.
            const dev = hausdorff(loops[0], outlineIn);
            if (!best || dev < best.maxDev) {
              best = { centerline: cl, width, closed: false, cap, join, maxDev: dev, note: 'outline -> open stroke' };
            }
          }
        }
      }
    }
  }
  if (!best || best.maxDev > tol * 3) return null;
  return best;
}

/**
 * Distance from one end of a centerline to the outline, along the end tangent.
 *
 * Midpoint pairing cannot reach the tip: near a cap the inward ray crosses the
 * cap instead of the far wall, so those samples are dropped and the centerline
 * ends short. The outline itself says by how much.
 */
function capReach(pts: Pt[], end: 'start' | 'end', outline: Pt[], eps: number): number | null {
  if (pts.length < 2) return null;
  const p = end === 'start' ? pts[0] : pts[pts.length - 1];
  const inner = end === 'start' ? pts[1] : pts[pts.length - 2];
  const d = norm(sub(p, inner));
  if (d.x === 0 && d.y === 0) return null;
  const hit = rayHit(p, d, outline, eps);
  return hit ? hit.t : null;
}

/** Push the endpoints out along their end tangents, by `ds` and `de`. */
function extendEnds(pts: Pt[], ds: number, de: number): Pt[] {
  if (pts.length < 2) return pts;
  const out = pts.slice();
  if (ds > 0) out[0] = add(out[0], mul(norm(sub(out[0], out[1])), ds));
  if (de > 0) {
    const n = out.length - 1;
    out[n] = add(out[n], mul(norm(sub(out[n], out[n - 1])), de));
  }
  return out;
}

/**
 * An outer contour with an inner contour at constant distance — a closed
 * stroke (the two-concentric-circles "ring" is the common case).
 */
export function detectAnnulusStroke(outer: Pt[], inner: Pt[], tol: number): StrokeCandidate | null {
  const O = resample(outer, Math.min(200, Math.max(48, outer.length)));
  const I = resample(inner, Math.min(200, Math.max(48, inner.length)));
  if (O.length < 8 || I.length < 8) return null;

  const pairs: { p: Pt; q: Pt; w: number }[] = [];
  for (const p of O) {
    const q = closestOnPoly(p, I);
    if (!q) continue;
    pairs.push({ p, q: q.p, w: q.d });
  }
  if (pairs.length < 8) return null;

  const gap = medianOf(pairs.map((x) => x.w));
  if (gap <= tol * 2) return null;
  const wTol = Math.max(tol * 2, gap * 0.06);
  const good = pairs.filter((x) => Math.abs(x.w - gap) <= wTol);
  // Corners break the constant-gap assumption locally, so allow a minority of
  // outliers — but the straight runs must agree.
  if (good.length < pairs.length * 0.7) return null;

  // Build the centerline from the reliable samples only; corner samples pull it
  // off the true path.
  const centerRaw = dedupeClose(good.map((x) => mid(x.p, x.q)), gap * 0.02);
  if (centerRaw.length < 6) return null;

  const candidates = [centerRaw, cleanCenterline(centerRaw, true, Math.max(tol, gap * 0.05))];

  let best: StrokeCandidate | null = null;
  for (const centerline of candidates) {
    if (centerline.length < 3) continue;
    for (const join of JOINS) {
      const loops = expandStroke(centerline, gap, true, 'butt', join);
      if (loops.length !== 2) continue;
      // Match each generated loop to whichever source contour it is closer to,
      // against the full-resolution contours: the resampled O and I have their
      // corners cut, which would charge a good fit for the resampling.
      const devA = Math.max(directedHausdorff(loops[0], outer), directedHausdorff(loops[1], inner));
      const devB = Math.max(directedHausdorff(loops[1], outer), directedHausdorff(loops[0], inner));
      const dev = Math.min(devA, devB);
      if (!best || dev < best.maxDev) {
        best = { centerline, width: gap, closed: true, cap: 'butt', join, maxDev: dev, note: 'annulus -> closed stroke' };
      }
    }
  }
  if (!best || best.maxDev > tol * 3) return null;
  return best;
}

function closestOnPoly(p: Pt, poly: Pt[]): { p: Pt; d: number } | null {
  let best: { p: Pt; d: number } | null = null;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l2 = ex * ex + ey * ey;
    let t = l2 === 0 ? 0 : ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q = { x: a.x + ex * t, y: a.y + ey * t };
    const d = dist(p, q);
    if (!best || d < best.d) best = { p: q, d };
  }
  return best;
}

function dedupeClose(pts: Pt[], eps: number): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > eps) out.push(p);
  }
  return out;
}

export { signedArea };
