import type { Pt, Scene, Shape } from '../types.ts';
import { parseXML, type XNode } from '../parse/xml.ts';
import { IDENT, matMul, parseTransform, scaleOf } from '../geom/mat.ts';
import { shapeToCmds, normalizeSVG } from '../parse/normalize.ts';
import { flattenSVG } from './flatten.ts';
import { flattenSubPath, splitSubPaths, transformCmds } from '../parse/path.ts';
import { bboxDiag, bboxOf, hausdorff, resample } from '../geom/poly.ts';
import { sampleFit } from '../fit/primitives.ts';
import { dist } from '../geom/vec.ts';

export interface GTPrim {
  kind: 'circle' | 'ellipse' | 'rect' | 'line' | 'polygon' | 'path';
  c: Pt;
  /** Radius, or half-diagonal for rects. */
  r: number;
  w?: number;
  h?: number;
  strokeWidth: number;
}

/** Read the primitives an author actually declared in an editable SVG. */
export function groundTruth(src: string): GTPrim[] {
  const root = parseXML(src);
  const out: GTPrim[] = [];
  const walk = (node: XNode, ctm: typeof IDENT, sw: number): void => {
    for (const ch of node.children) {
      const m = matMul(ctm, parseTransform(ch.attrs['transform']));
      const s = scaleOf(m);
      const own = ch.attrs['stroke-width'] != null ? parseFloat(ch.attrs['stroke-width']) : sw;
      const stroked = ch.attrs['stroke'] && ch.attrs['stroke'] !== 'none' ? own * s : 0;
      const a = ch.attrs;
      const n = (k: string): number => parseFloat(a[k] ?? '0') || 0;
      switch (ch.tag) {
        case 'circle': {
          const sx = Math.hypot(m.a, m.b);
          const sy = Math.hypot(m.c, m.d);
          // Under a non-uniform transform the author's circle really is an
          // ellipse; scoring it as a circle would mark the right answer wrong.
          const kind = Math.abs(sx - sy) > 1e-6 * Math.max(1, sx) ? 'ellipse' : 'circle';
          out.push({
            kind,
            c: tp(m, { x: n('cx'), y: n('cy') }),
            r: n('r') * Math.max(sx, sy),
            w: n('r') * sx,
            h: n('r') * sy,
            strokeWidth: stroked,
          });
          break;
        }
        case 'ellipse':
          out.push({
            kind: 'ellipse',
            c: tp(m, { x: n('cx'), y: n('cy') }),
            r: Math.max(n('rx'), n('ry')) * s,
            w: n('rx') * s,
            h: n('ry') * s,
            strokeWidth: stroked,
          });
          break;
        case 'rect': {
          const w = n('width') * s;
          const h = n('height') * s;
          out.push({
            kind: 'rect',
            c: tp(m, { x: n('x') + n('width') / 2, y: n('y') + n('height') / 2 }),
            r: Math.hypot(w, h) / 2,
            w,
            h,
            strokeWidth: stroked,
          });
          break;
        }
        case 'line':
          out.push({
            kind: 'line',
            c: tp(m, { x: (n('x1') + n('x2')) / 2, y: (n('y1') + n('y2')) / 2 }),
            r: (Math.hypot(n('x2') - n('x1'), n('y2') - n('y1')) / 2) * s,
            strokeWidth: stroked,
          });
          break;
        case 'polygon':
        case 'polyline':
        case 'path': {
          const cmds = shapeToCmds(ch);
          if (!cmds) break;
          const pts: Pt[] = [];
          for (const sub of splitSubPaths(transformCmds(cmds, m))) for (const p of flattenSubPath(sub, 0.5)) pts.push(p);
          if (!pts.length) break;
          const bb = bboxOf(pts);
          out.push({
            kind: ch.tag === 'path' ? 'path' : 'polygon',
            c: { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 },
            r: bboxDiag(bb) / 2,
            strokeWidth: stroked,
          });
          break;
        }
        default:
          walk(ch, m, own);
          continue;
      }
      if (ch.children.length) walk(ch, m, own);
    }
  };
  walk(root, IDENT, 1);
  return out;
}

const tp = (m: typeof IDENT, p: Pt): Pt => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

function shapeToGT(s: Shape): GTPrim | null {
  const sw = s.style.stroke ? (s.style.strokeWidth ?? 0) : 0;
  switch (s.kind) {
    case 'circle':
      return { kind: 'circle', c: s.c, r: s.r, strokeWidth: sw };
    case 'ellipse':
      return { kind: 'ellipse', c: s.c, r: Math.max(s.rx, s.ry), w: s.rx, h: s.ry, strokeWidth: sw };
    case 'rect': {
      const cos = Math.cos(s.rot);
      const sin = Math.sin(s.rot);
      const cx = s.x + (cos * s.w - sin * s.h) / 2;
      const cy = s.y + (sin * s.w + cos * s.h) / 2;
      return { kind: 'rect', c: { x: cx, y: cy }, r: Math.hypot(s.w, s.h) / 2, w: s.w, h: s.h, strokeWidth: sw };
    }
    case 'line':
      return {
        kind: 'line',
        c: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 },
        r: dist(s.a, s.b) / 2,
        strokeWidth: sw,
      };
    case 'polygon': {
      // Ground truth measures polygons by bbox, so measure ours the same way —
      // circumradius vs half-diagonal would never line up.
      const bb = bboxOf(s.pts);
      return {
        kind: 'polygon',
        c: { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 },
        r: bboxDiag(bb) / 2,
        strokeWidth: sw,
      };
    }
    case 'path': {
      // Ground truth has `path` entries too, so score them on bbox agreement
      // rather than dropping them and flattering the precision number.
      const pts: Pt[] = [];
      for (const c of s.contours) for (const f of c.segs) for (const p of sampleFit(f, 24)) pts.push(p);
      if (!pts.length) return null;
      const bb = bboxOf(pts);
      return {
        kind: 'path',
        c: { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 },
        r: bboxDiag(bb) / 2,
        strokeWidth: sw,
      };
    }
    case 'text':
      // The bench scores geometry; text has none to compare.
      return null;
  }
}

export interface CompareResult {
  /** Symmetric Hausdorff between original and reconstruction, as a fraction of the diagonal. */
  relHausdorff: number;
  precision: number;
  recall: number;
  f1: number;
  matched: number;
  gtCount: number;
  outCount: number;
  /** Coordinate counts: flattened input vs reconstructed output. */
  coordsIn: number;
  coordsOut: number;
}

/** Point cloud sampled from every contour of an SVG, for geometric comparison. */
export function cloudOf(svg: string, perRegion = 96): Pt[] {
  const doc = normalizeSVG(svg);
  const out: Pt[] = [];
  for (const r of doc.regions) for (const p of resample(r.poly, Math.min(perRegion, Math.max(8, r.poly.length)))) out.push(p);
  return out;
}

export function countCoords(svg: string): number {
  return (svg.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).length;
}

export function compare(originalSVG: string, flatSVG: string, scene: Scene, outSVG: string): CompareResult {
  const gt = groundTruth(originalSVG);
  const out = scene.shapes.map(shapeToGT).filter((x): x is GTPrim => x !== null);

  // Compare what actually renders. Sampling the raw elements would miss
  // strokes entirely and score a correct stroke recovery as half a width off.
  const cloudA = cloudOf(flatSVG);
  const cloudB = cloudOf(flattenSVG(outSVG));
  const diag = cloudA.length ? bboxDiag(bboxOf(cloudA)) : 1;
  const relH = cloudA.length && cloudB.length ? hausdorff(cloudA, cloudB) / diag : 1;

  // Match tolerance: generous enough that a visually identical primitive counts,
  // tight enough that a wrong shape does not.
  const tol = diag * 0.02;
  // A star drawn as <polygon> and recovered as an exact 10-line path is the
  // same answer, so those two kinds are interchangeable for scoring.
  const sameKind = (a: GTPrim['kind'], b: GTPrim['kind']): boolean => {
    if (a === b) return true;
    const free = (k: GTPrim['kind']): boolean => k === 'polygon' || k === 'path';
    return free(a) && free(b);
  };

  const takenOut = new Set<number>();
  let matched = 0;
  for (const g of gt) {
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < out.length; i++) {
      if (takenOut.has(i)) continue;
      const o = out[i];
      if (!sameKind(o.kind, g.kind)) continue;
      const d = dist(o.c, g.c) + Math.abs(o.r - g.r) + Math.abs(o.strokeWidth - g.strokeWidth);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI >= 0 && bestD <= tol * 3) {
      takenOut.add(bestI);
      matched++;
    }
  }

  const precision = out.length ? matched / out.length : 0;
  const recall = gt.length ? matched / gt.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    relHausdorff: relH,
    precision,
    recall,
    f1,
    matched,
    gtCount: gt.length,
    outCount: out.length,
    coordsIn: countCoords(flatSVG),
    coordsOut: countCoords(outSVG),
  };
}
