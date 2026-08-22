import type {
  BBox,
  Constraint,
  Construction,
  Contour,
  Fit,
  Pt,
  Region,
  SegNote,
  SegRef,
  Shape,
} from '../types.ts';
import { cross, dist, dot, norm, sub } from '../geom/vec.ts';
import { bboxOf } from '../geom/poly.ts';
import { segTangent } from '../geom/seg.ts';
import { expandStroke, type Cap, type Join } from '../geom/offset.ts';

/**
 * Segment-level construction analysis.
 *
 * `detectConstraints` works on whole shapes — two circles that share a radius,
 * an axis three shapes mirror about. It cannot see inside a path, so an arc/line
 * skeleton (a lettermark drawn as one stroked centerline) comes out described
 * only as "7 line, 6 arc". This module reads that interior: what each segment's
 * defining value is, whether each join is tangent or a corner, which arcs share
 * a radius, which are true half-turns.
 *
 * Radii are reported, never snapped. Segment endpoints are shared with their
 * neighbours, so moving one radius breaks the chain — resolving that needs a
 * real constraint solver, which this project does not have.
 */

/** Unsigned turn between the outgoing tangent of `f` and the incoming one of `g`. */
function joinAngle(f: Fit, g: Fit): number | null {
  const out = segTangent(f, 'end');
  const inc = segTangent(g, 'start');
  if (!out || !inc) return null;
  return Math.abs(Math.atan2(cross(out, inc), dot(out, inc)));
}

const deg = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(1)}deg`;

function valueOf(f: Fit, tol: number): { value: string; r?: number; sweep?: number } {
  switch (f.kind) {
    case 'line': {
      const l = dist(f.a, f.b);
      if (Math.abs(f.a.x - f.b.x) <= tol) return { value: `v x=${f.a.x.toFixed(2)} len=${l.toFixed(2)}` };
      if (Math.abs(f.a.y - f.b.y) <= tol) return { value: `h y=${f.a.y.toFixed(2)} len=${l.toFixed(2)}` };
      const ang = Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x);
      return { value: `${deg(ang)} len=${l.toFixed(2)}` };
    }
    case 'arc': {
      const sweep = f.a1 - f.a0;
      return {
        value: `r ${f.r.toFixed(3)} sweep ${deg(Math.abs(sweep))} ${sweep > 0 ? 'cw' : 'ccw'}`,
        r: f.r,
        sweep,
      };
    }
    case 'circle':
      return { value: `r ${f.r.toFixed(3)} closed`, r: f.r };
    case 'ellipse':
      return { value: `rx ${f.rx.toFixed(3)} ry ${f.ry.toFixed(3)} rot ${deg(f.rot)}` };
    case 'cubic':
      return { value: `${f.pts.length} samples, unmodelled` };
  }
}

/** Group arc radii that sit within `tol` of each other. */
function clusterRadii(items: { ref: SegRef; r: number }[], tol: number): { ref: SegRef; r: number }[][] {
  const sorted = [...items].sort((a, b) => a.r - b.r);
  const out: { ref: SegRef; r: number }[][] = [];
  let cur: { ref: SegRef; r: number }[] = [];
  for (const it of sorted) {
    if (!cur.length || Math.abs(it.r - cur[cur.length - 1].r) <= tol) cur.push(it);
    else {
      out.push(cur);
      cur = [it];
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((g) => g.length > 1);
}

/**
 * Bbox of the painted ink.
 *
 * A filled region's outline already *is* its ink boundary. A stroked one is
 * expanded, because growing the geometry bbox by half a width is only an upper
 * bound: a butt cap paints nothing past the endpoint, so that shortcut would
 * claim ink where there is none — and then report a viewBox as tight when the
 * mark does not reach it.
 */
export function inkBBox(regions: Region[], fallback: BBox): BBox {
  let out: BBox | null = null;
  const union = (b: BBox): void => {
    out = out
      ? { x0: Math.min(out.x0, b.x0), y0: Math.min(out.y0, b.y0), x1: Math.max(out.x1, b.x1), y1: Math.max(out.y1, b.y1) }
      : b;
  };
  for (const r of regions) {
    const w = r.style.stroke ? (r.style.strokeWidth ?? 1) : 0;
    if (w <= 0) {
      union(r.bbox);
      continue;
    }
    const cap: Cap = r.style.strokeLinecap ?? 'butt';
    // `expandStroke` offers round and miter; a bevel differs only inside the
    // join, never outside the miter it replaces, so it cannot extend the bbox.
    const join: Join = r.style.strokeLinejoin === 'round' ? 'round' : 'miter';
    const loops = expandStroke(r.poly, w, r.closed, cap, join);
    if (!loops.length) {
      const g = w / 2;
      union({ x0: r.bbox.x0 - g, y0: r.bbox.y0 - g, x1: r.bbox.x1 + g, y1: r.bbox.y1 + g });
      continue;
    }
    for (const loop of loops) union(bboxOf(loop));
  }
  return out ?? fallback;
}

export interface ConstructionResult {
  construction: Construction;
  /** Segment-level constraints, to append to the scene's list. */
  constraints: Constraint[];
  notes: string[];
}

export function analyzeConstruction(
  shapes: Shape[],
  ink: BBox,
  viewBox: [number, number, number, number],
  tol: number,
  g1Tol: number,
): ConstructionResult {
  const segs: SegNote[] = [];
  const constraints: Constraint[] = [];
  const notes: string[] = [];
  const arcs: { ref: SegRef; r: number }[] = [];

  for (const shape of shapes) {
    if (shape.kind !== 'path') continue;
    shape.contours.forEach((contour: Contour, ci: number) => {
      const n = contour.segs.length;
      // Continuity at join i is between seg i and seg i+1; a closed contour also
      // joins the last back to the first.
      const joins: (number | null)[] = new Array(n).fill(null);
      for (let i = 0; i < n; i++) {
        const next = i + 1 < n ? i + 1 : contour.closed ? 0 : -1;
        if (next < 0) continue;
        joins[i] = joinAngle(contour.segs[i], contour.segs[next]);
      }

      for (let i = 0; i < n; i++) {
        const f = contour.segs[i];
        const ref: SegRef = { shape: shape.id, contour: ci, seg: i };
        const { value, r, sweep } = valueOf(f, tol);

        const prevIdx = i > 0 ? i - 1 : contour.closed ? n - 1 : -1;
        const inAng = prevIdx >= 0 ? joins[prevIdx] : null;
        const outAng = joins[i];
        const bits: string[] = [];
        const label = (a: number | null, side: string): void => {
          if (a == null) return;
          bits.push(a <= g1Tol ? `G1 ${side}` : `corner ${deg(a)} ${side}`);
        };
        if (inAng == null && !contour.closed && i === 0) bits.push('start');
        label(inAng, 'in');
        label(outAng, 'out');
        if (outAng == null && !contour.closed && i === n - 1) bits.push('end');
        const relation =
          inAng != null && outAng != null && inAng <= g1Tol && outAng <= g1Tol ? 'G1 both ends' : bits.join(', ');

        segs.push({ ref, kind: f.kind, value, relation, r, sweep });
        if (f.kind === 'arc' && r != null) arcs.push({ ref, r });

        // Half-turns: the flags that collapse an S into a comb when reversed.
        if (f.kind === 'arc' && sweep != null && Math.abs(Math.abs(sweep) - Math.PI) <= g1Tol) {
          constraints.push({ kind: 'semicircle', seg: ref, sweep });
        }
      }

      for (let i = 0; i < n; i++) {
        const a = joins[i];
        if (a == null) continue;
        const nextIdx = i + 1 < n ? i + 1 : 0;
        const from: SegRef = { shape: shape.id, contour: ci, seg: i };
        const to: SegRef = { shape: shape.id, contour: ci, seg: nextIdx };
        const kinds = [contour.segs[i].kind, contour.segs[nextIdx].kind];
        if (a <= g1Tol) {
          const solved = kinds.includes('arc') && kinds.includes('line');
          constraints.push({ kind: 'tangent', a: from, b: to, residual: a, solved });
        } else {
          constraints.push({ kind: 'corner', a: from, b: to, angle: a });
        }
      }
    });
  }

  for (const group of clusterRadii(arcs, tol * 4)) {
    const value = group.reduce((s, g) => s + g.r, 0) / group.length;
    constraints.push({ kind: 'equal-radius-seg', segs: group.map((g) => g.ref), value });
    notes.push(`equal-radius: ${group.length} arc segments at r=${value.toFixed(3)} (reported, not snapped)`);
  }

  const w = ink.x1 - ink.x0;
  const h = ink.y1 - ink.y0;
  const aspect = h > 0 ? w / h : 0;
  const tightViewBox =
    Math.abs(ink.x0 - viewBox[0]) <= tol &&
    Math.abs(ink.y0 - viewBox[1]) <= tol &&
    Math.abs(ink.x1 - (viewBox[0] + viewBox[2])) <= tol &&
    Math.abs(ink.y1 - (viewBox[1] + viewBox[3])) <= tol;
  constraints.push({ kind: 'aspect', ratio: aspect, tight: tightViewBox });
  if (tightViewBox) notes.push('ink bbox == viewBox: the mark touches all four edges');

  const strokes: Construction['strokes'] = [];
  for (const s of shapes) {
    const wid = s.style.stroke ? s.style.strokeWidth : undefined;
    if (wid == null) continue;
    if (strokes.some((k) => Math.abs(k.width - wid) <= tol)) continue;
    strokes.push({
      width: wid,
      ofHeight: h > 0 ? wid / h : 0,
      cap: s.style.strokeLinecap ?? 'butt',
      join: s.style.strokeLinejoin ?? 'miter',
    });
  }

  return { construction: { segs, ink, aspect, tightViewBox, strokes }, constraints, notes };
}
