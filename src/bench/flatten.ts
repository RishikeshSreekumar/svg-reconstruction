import type { Cmd, Pt } from '../types.ts';
import { parseXML, type XNode } from '../parse/xml.ts';
import { shapeToCmds } from '../parse/normalize.ts';
import { matMul, parseTransform, IDENT } from '../geom/mat.ts';
import { flattenSubPath, splitSubPaths, transformCmds } from '../parse/path.ts';
import { expandStroke, type Cap, type Join } from '../geom/offset.ts';
import { bboxDiag, bboxOf, signedArea } from '../geom/poly.ts';

export interface FlattenOptions {
  /** Coordinate decimal places, mimicking what real exporters emit. */
  precision?: number;
  /** Curve sampling tolerance, as a fraction of the artwork diagonal. */
  relTol?: number;
  /** Convert every curve to cubics (what "flatten" usually means in the wild). */
  toCubics?: boolean;
}

/**
 * Forward model: editable SVG -> path soup.
 *
 * This is the ground-truth generator. Every fixture is authored with real
 * primitives and strokes, flattened here, and the reconstructor is scored on
 * how much of the original it gets back.
 */
export function flattenSVG(src: string, opts: FlattenOptions = {}): string {
  const prec = opts.precision ?? 2;
  const root = parseXML(src);
  const svg = findSvg(root);
  if (!svg) return src;

  const nums = (svg.attrs['viewbox'] ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number);
  const width = svg.attrs['width'] ?? String(nums?.[2] ?? 100);
  const height = svg.attrs['height'] ?? String(nums?.[3] ?? 100);
  const viewBox = svg.attrs['viewbox'] ?? `0 0 ${width} ${height}`;

  interface Piece {
    loops: Pt[][];
    fill: string;
    rule: 'nonzero' | 'evenodd';
  }
  const pieces: Piece[] = [];
  collect(svg, IDENT, { fill: 'black', stroke: null, sw: 1, cap: 'butt', join: 'miter', rule: 'nonzero' }, pieces, opts);

  const all: Pt[] = [];
  for (const p of pieces) for (const l of p.loops) for (const q of l) all.push(q);
  const diag = all.length ? bboxDiag(bboxOf(all)) : 100;
  const f = (v: number): string => {
    const s = v.toFixed(prec);
    return (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s) || '0';
  };

  const body = pieces
    .map((p) => {
      const d = p.loops
        .map((loop) => {
          const pts = loop;
          if (pts.length < 2) return '';
          const head = `M${f(pts[0].x)} ${f(pts[0].y)}`;
          const rest = pts.slice(1, -1).map((q) => `L${f(q.x)} ${f(q.y)}`).join('');
          return head + rest + 'Z';
        })
        .join('');
      return `  <path d="${d}" fill="${p.fill}" fill-rule="${p.rule}"/>`;
    })
    .filter(Boolean)
    .join('\n');

  void diag;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">\n${body}\n</svg>\n`;
}

interface FStyle {
  fill: string | null;
  stroke: string | null;
  sw: number;
  cap: Cap;
  join: Join;
  rule: 'nonzero' | 'evenodd';
}

const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'metadata', 'title', 'desc', 'style']);

function collect(
  node: XNode,
  ctm: ReturnType<typeof matMul>,
  style: FStyle,
  out: { loops: Pt[][]; fill: string; rule: 'nonzero' | 'evenodd' }[],
  opts: FlattenOptions,
): void {
  for (const child of node.children) {
    if (SKIP.has(child.tag)) continue;
    const m = matMul(ctm, parseTransform(child.attrs['transform']));
    const s = mergeStyle(child, style);
    if (child.tag === 'g' || child.tag === 'a') {
      collect(child, m, s, out, opts);
      continue;
    }
    const cmds = shapeToCmds(child);
    if (!cmds) {
      if (child.children.length) collect(child, m, s, out, opts);
      continue;
    }
    const abs = transformCmds(cmds, m);
    const subs = splitSubPaths(abs);
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

    const polys = subs.map((sub) => ({
      pts: flattenSubPath(sub, Math.max(0.02 * scale * (opts.relTol ?? 1), 0.01)),
      closed: sub.closed,
    }));

    if (s.fill) {
      out.push({
        loops: polys.filter((p) => p.pts.length > 2).map((p) => close(p.pts)),
        fill: s.fill,
        rule: s.rule,
      });
    }
    if (s.stroke && s.sw > 0) {
      const loops: Pt[][] = [];
      for (const p of polys) {
        if (p.pts.length < 2) continue;
        for (const l of expandStroke(p.pts, s.sw * scale, p.closed, s.cap, s.join)) loops.push(l);
      }
      // Inner loops of a closed stroke must wind opposite so nonzero cuts them.
      if (loops.length) out.push({ loops: fixWinding(loops), fill: s.stroke, rule: 'nonzero' });
    }
    if (child.children.length) collect(child, m, s, out, opts);
  }
}

function mergeStyle(node: XNode, s: FStyle): FStyle {
  const a = node.attrs;
  const css: Record<string, string> = {};
  for (const decl of (a['style'] ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) css[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  const get = (k: string): string | undefined => css[k] ?? a[k];
  const none = (v: string | undefined): boolean => v === 'none' || v === 'transparent';
  const out: FStyle = { ...s };
  const fill = get('fill');
  if (fill != null) out.fill = none(fill) ? null : fill;
  const stroke = get('stroke');
  if (stroke != null) out.stroke = none(stroke) ? null : stroke;
  const sw = get('stroke-width');
  if (sw != null) out.sw = parseFloat(sw) || 0;
  const cap = get('stroke-linecap');
  if (cap === 'round' || cap === 'square' || cap === 'butt') out.cap = cap;
  const join = get('stroke-linejoin');
  if (join === 'round' || join === 'bevel' || join === 'miter') out.join = join;
  const rule = get('fill-rule');
  if (rule === 'evenodd' || rule === 'nonzero') out.rule = rule;
  return out;
}

function close(pts: Pt[]): Pt[] {
  const out = pts.slice();
  const a = out[0];
  const b = out[out.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-9) out.push({ ...a });
  return out;
}

/** Give the largest loop one winding and every nested loop the opposite. */
function fixWinding(loops: Pt[][]): Pt[][] {
  if (loops.length < 2) return loops;
  const areas = loops.map(signedArea);
  const maxI = areas.reduce((best, a, i) => (Math.abs(a) > Math.abs(areas[best]) ? i : best), 0);
  const sign = Math.sign(areas[maxI]) || 1;
  return loops.map((l, i) => (i === maxI || Math.sign(areas[i]) !== sign ? l : l.slice().reverse()));
}

function findSvg(root: XNode): XNode | null {
  if (root.tag === 'svg') return root;
  for (const c of root.children) {
    const hit = findSvg(c);
    if (hit) return hit;
  }
  return null;
}

export type { Cmd };
