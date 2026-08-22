import type { Cmd, Mat, Pt, Region, Style, SubPath } from '../types.ts';
import { IDENT, matMul, parseTransform } from '../geom/mat.ts';
import { bboxDiag, bboxOf, bboxUnion, dedupe, densify, signedArea } from '../geom/poly.ts';
import { flattenSubPath, parsePathData, splitSubPaths, transformCmds } from './path.ts';
import { parseXML, type XNode } from './xml.ts';

export interface Doc {
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  regions: Region[];
  /** `<text>` elements, carried through untouched — they are never fitted. */
  texts?: DocText[];
}

export interface DocText {
  p: Pt;
  text: string;
  fontSize: number;
  fontFamily: string;
  anchor: 'start' | 'middle' | 'end';
  style: Style;
  /** Set when the element carried a rotation the passthrough dropped. */
  note?: string;
}

const NUM_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

function num(v: string | undefined, dflt = 0): number {
  if (v == null) return dflt;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

function parseStyleAttr(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

const isNone = (v: string | undefined): boolean => v == null || v === 'none' || v === 'transparent';

function resolveStyle(node: XNode, inherited: Style): Style {
  const css = parseStyleAttr(node.attrs['style']);
  const get = (k: string): string | undefined => css[k] ?? node.attrs[k];

  const out: Style = { ...inherited };
  const fill = get('fill');
  if (fill != null) out.fill = isNone(fill) ? null : fill;
  const stroke = get('stroke');
  if (stroke != null) out.stroke = isNone(stroke) ? null : stroke;
  const sw = get('stroke-width');
  if (sw != null) out.strokeWidth = num(sw, 1);
  const fr = get('fill-rule');
  if (fr === 'evenodd' || fr === 'nonzero') out.fillRule = fr;
  const lc = get('stroke-linecap');
  if (lc === 'butt' || lc === 'round' || lc === 'square') out.strokeLinecap = lc;
  const lj = get('stroke-linejoin');
  if (lj === 'miter' || lj === 'round' || lj === 'bevel') out.strokeLinejoin = lj;
  const op = get('opacity');
  if (op != null) out.opacity = num(op, 1);
  return out;
}

/** Convert a basic shape element into absolute path commands. */
export function shapeToCmds(node: XNode): Cmd[] | null {
  const a = node.attrs;
  switch (node.tag) {
    case 'path':
      return a['d'] ? parsePathData(a['d']) : null;

    case 'rect': {
      const x = num(a['x']);
      const y = num(a['y']);
      const w = num(a['width']);
      const h = num(a['height']);
      if (w <= 0 || h <= 0) return null;
      let rx = a['rx'] != null ? num(a['rx']) : a['ry'] != null ? num(a['ry']) : 0;
      let ry = a['ry'] != null ? num(a['ry']) : a['rx'] != null ? num(a['rx']) : 0;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) {
        return [
          { t: 'M', p: { x, y } },
          { t: 'L', p: { x: x + w, y } },
          { t: 'L', p: { x: x + w, y: y + h } },
          { t: 'L', p: { x, y: y + h } },
          { t: 'Z' },
        ];
      }
      const A = (p: Pt): Cmd => ({ t: 'A', rx, ry, rot: 0, large: false, sweep: true, p });
      return [
        { t: 'M', p: { x: x + rx, y } },
        { t: 'L', p: { x: x + w - rx, y } },
        A({ x: x + w, y: y + ry }),
        { t: 'L', p: { x: x + w, y: y + h - ry } },
        A({ x: x + w - rx, y: y + h }),
        { t: 'L', p: { x: x + rx, y: y + h } },
        A({ x, y: y + h - ry }),
        { t: 'L', p: { x, y: y + ry } },
        A({ x: x + rx, y }),
        { t: 'Z' },
      ];
    }

    case 'circle':
    case 'ellipse': {
      const cx = num(a['cx']);
      const cy = num(a['cy']);
      const rx = node.tag === 'circle' ? num(a['r']) : num(a['rx']);
      const ry = node.tag === 'circle' ? num(a['r']) : num(a['ry']);
      if (rx <= 0 || ry <= 0) return null;
      return [
        { t: 'M', p: { x: cx + rx, y: cy } },
        { t: 'A', rx, ry, rot: 0, large: false, sweep: true, p: { x: cx - rx, y: cy } },
        { t: 'A', rx, ry, rot: 0, large: false, sweep: true, p: { x: cx + rx, y: cy } },
        { t: 'Z' },
      ];
    }

    case 'line':
      return [
        { t: 'M', p: { x: num(a['x1']), y: num(a['y1']) } },
        { t: 'L', p: { x: num(a['x2']), y: num(a['y2']) } },
      ];

    case 'polyline':
    case 'polygon': {
      const n = (a['points'] ?? '').match(NUM_RE)?.map(Number) ?? [];
      if (n.length < 4) return null;
      const cmds: Cmd[] = [{ t: 'M', p: { x: n[0], y: n[1] } }];
      for (let i = 2; i + 1 < n.length; i += 2) cmds.push({ t: 'L', p: { x: n[i], y: n[i + 1] } });
      if (node.tag === 'polygon') cmds.push({ t: 'Z' });
      return cmds;
    }
  }
  return null;
}

const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'metadata', 'title', 'desc', 'style']);

interface RawShape {
  cmds: Cmd[];
  style: Style;
}

/** All character data inside a node, `<tspan>` descendants included. */
function textContent(node: XNode): string {
  let s = node.text ?? '';
  for (const c of node.children) s += textContent(c);
  return s;
}

function walk(node: XNode, ctm: Mat, style: Style, out: RawShape[], texts: DocText[]): void {
  for (const child of node.children) {
    if (SKIP.has(child.tag)) continue;
    const m = matMul(ctm, parseTransform(child.attrs['transform']));
    const s = resolveStyle(child, style);
    if (child.tag === 'g' || child.tag === 'svg' || child.tag === 'a') {
      walk(child, m, s, out, texts);
      continue;
    }
    if (child.tag === 'text') {
      const t = collectText(child, m, s);
      if (t) texts.push(t);
      continue; // never treat text content as geometry
    }
    const cmds = shapeToCmds(child);
    if (cmds && cmds.length) out.push({ cmds: transformCmds(cmds, m), style: s });
    if (child.children.length) walk(child, m, s, out, texts);
  }
}

/**
 * Passthrough for `<text>`: translate the anchor and scale the size by the
 * CTM's uniform scale. Rotation/skew is out of scope — noted, not applied.
 */
function collectText(node: XNode, m: Mat, style: Style): DocText | null {
  const content = textContent(node).trim();
  if (!content) return null;
  const css = parseStyleAttr(node.attrs['style']);
  const get = (k: string): string | undefined => css[k] ?? node.attrs[k];
  const x = num(node.attrs['x']);
  const y = num(node.attrs['y']);
  const p: Pt = { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  const anchorRaw = get('text-anchor');
  const anchor = anchorRaw === 'middle' || anchorRaw === 'end' ? anchorRaw : 'start';
  const rotated = Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9;
  return {
    p,
    text: content,
    fontSize: num(get('font-size'), 16) * scale,
    fontFamily: get('font-family') ?? 'sans-serif',
    anchor,
    style,
    note: rotated ? 'text transform: rotation dropped' : undefined,
  };
}

export interface NormalizeOptions {
  /** Flatten tolerance as a fraction of the artwork diagonal. */
  relFlatten?: number;
}

/** Parse an SVG string into transform-free, absolute, per-subpath regions. */
export function normalizeSVG(src: string, opts: NormalizeOptions = {}): Doc {
  const root = parseXML(src);
  const svg = findSvg(root);
  if (!svg) return { width: 0, height: 0, viewBox: [0, 0, 0, 0], regions: [] };

  const vbNums = (svg.attrs['viewbox'] ?? '').match(NUM_RE)?.map(Number);
  const width = num(svg.attrs['width'], vbNums?.[2] ?? 100);
  const height = num(svg.attrs['height'], vbNums?.[3] ?? 100);
  const viewBox: [number, number, number, number] =
    vbNums && vbNums.length >= 4 ? [vbNums[0], vbNums[1], vbNums[2], vbNums[3]] : [0, 0, width, height];

  const baseStyle: Style = { fill: 'black', stroke: null, strokeWidth: 1, fillRule: 'nonzero' };
  const raws: RawShape[] = [];
  const texts: DocText[] = [];
  walk(svg, matMul(IDENT, parseTransform(svg.attrs['transform'])), baseStyle, raws, texts);

  // Two passes: measure the artwork so the flatten tolerance is scale-relative,
  // then sample. Fixed absolute tolerances break on tiny or huge viewBoxes.
  const coarse: Pt[] = [];
  for (const r of raws) {
    for (const sub of splitSubPaths(r.cmds)) {
      const pts = flattenSubPath(sub, 1);
      for (const p of pts) coarse.push(p);
    }
  }
  const diag = coarse.length ? bboxDiag(bboxOf(coarse)) : Math.hypot(viewBox[2], viewBox[3]);
  const flatTol = Math.max(diag * (opts.relFlatten ?? 0.0002), 1e-9);

  // Long straight runs must carry interior samples, or a circle fits a square's
  // four corners exactly and nothing downstream can tell the difference.
  const maxSeg = Math.max(diag * 0.008, 1e-9);

  const regions: Region[] = [];
  let idx = 0;
  for (let elem = 0; elem < raws.length; elem++) {
    const r = raws[elem];
    for (const sub of splitSubPaths(r.cmds)) {
      const poly = densify(dedupe(flattenSubPath(sub, flatTol), flatTol * 0.01), maxSeg);
      if (poly.length < 2) continue;
      regions.push({
        id: `r${idx++}`,
        elem,
        sub,
        poly,
        closed: sub.closed,
        style: r.style,
        area: signedArea(poly),
        bbox: bboxOf(poly),
      });
    }
  }
  return { width, height, viewBox, regions, texts };
}

function findSvg(root: XNode): XNode | null {
  if (root.tag === 'svg') return root;
  for (const c of root.children) {
    const hit = findSvg(c);
    if (hit) return hit;
  }
  return null;
}

export function docBBox(doc: Doc): { x0: number; y0: number; x1: number; y1: number } {
  if (!doc.regions.length) return { x0: 0, y0: 0, x1: doc.viewBox[2], y1: doc.viewBox[3] };
  return doc.regions.map((r) => r.bbox).reduce(bboxUnion);
}

export type { SubPath, Region };
