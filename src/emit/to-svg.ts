import type { Contour, Fit, Pt, Scene, SegRef, Shape, Style } from '../types.ts';
import { dist } from '../geom/vec.ts';

export interface EmitOptions {
  /** Decimal places for coordinates. */
  precision?: number;
  /** Emit data-* attributes carrying confidence and provenance. */
  annotate?: boolean;
}

const fmt = (v: number, p: number): string => {
  const s = v.toFixed(p);
  return (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s) || '0';
};

const escXML = (s: string): string =>
  s.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));

function styleAttrs(s: Style, p: number): string {
  const parts: string[] = [];
  parts.push(`fill="${s.fill ?? 'none'}"`);
  if (s.stroke) {
    parts.push(`stroke="${s.stroke}"`);
    if (s.strokeWidth != null) parts.push(`stroke-width="${fmt(s.strokeWidth, p)}"`);
    if (s.strokeLinecap && s.strokeLinecap !== 'butt') parts.push(`stroke-linecap="${s.strokeLinecap}"`);
    if (s.strokeLinejoin && s.strokeLinejoin !== 'miter') parts.push(`stroke-linejoin="${s.strokeLinejoin}"`);
  }
  if (s.fillRule === 'evenodd') parts.push('fill-rule="evenodd"');
  if (s.opacity != null && s.opacity !== 1) parts.push(`opacity="${fmt(s.opacity, 3)}"`);
  return parts.join(' ');
}

/** Emit one fitted primitive as path data, continuing from the current point. */
function fitToD(f: Fit, p: number, first: boolean): string {
  const M = (pt: Pt): string => `M${fmt(pt.x, p)} ${fmt(pt.y, p)}`;
  switch (f.kind) {
    case 'line':
      return `${first ? M(f.a) : ''}L${fmt(f.b.x, p)} ${fmt(f.b.y, p)}`;
    case 'arc': {
      const sweepAng = f.a1 - f.a0;
      const large = Math.abs(sweepAng) > Math.PI ? 1 : 0;
      const sweep = sweepAng > 0 ? 1 : 0;
      const end = { x: f.c.x + f.r * Math.cos(f.a1), y: f.c.y + f.r * Math.sin(f.a1) };
      const start = { x: f.c.x + f.r * Math.cos(f.a0), y: f.c.y + f.r * Math.sin(f.a0) };
      return `${first ? M(start) : ''}A${fmt(f.r, p)} ${fmt(f.r, p)} 0 ${large} ${sweep} ${fmt(end.x, p)} ${fmt(end.y, p)}`;
    }
    case 'circle': {
      const a = { x: f.c.x + f.r, y: f.c.y };
      const b = { x: f.c.x - f.r, y: f.c.y };
      return `${M(a)}A${fmt(f.r, p)} ${fmt(f.r, p)} 0 1 1 ${fmt(b.x, p)} ${fmt(b.y, p)}A${fmt(f.r, p)} ${fmt(f.r, p)} 0 1 1 ${fmt(a.x, p)} ${fmt(a.y, p)}Z`;
    }
    case 'ellipse': {
      const cos = Math.cos(f.rot);
      const sin = Math.sin(f.rot);
      const at = (t: number): Pt => ({
        x: f.c.x + cos * f.rx * Math.cos(t) - sin * f.ry * Math.sin(t),
        y: f.c.y + sin * f.rx * Math.cos(t) + cos * f.ry * Math.sin(t),
      });
      const a = at(0);
      const b = at(Math.PI);
      const rot = fmt((f.rot * 180) / Math.PI, p);
      return `${M(a)}A${fmt(f.rx, p)} ${fmt(f.ry, p)} ${rot} 1 1 ${fmt(b.x, p)} ${fmt(b.y, p)}A${fmt(f.rx, p)} ${fmt(f.ry, p)} ${rot} 1 1 ${fmt(a.x, p)} ${fmt(a.y, p)}Z`;
    }
    case 'cubic': {
      // Unmodelled fallback: keep the samples as a polyline so nothing is lost.
      const pts = f.pts;
      const head = first ? M(pts[0]) : '';
      return head + pts.slice(1).map((q) => `L${fmt(q.x, p)} ${fmt(q.y, p)}`).join('');
    }
  }
}

export function contourToD(c: Contour, p: number): string {
  if (!c.segs.length) return '';
  const parts: string[] = [];
  for (let i = 0; i < c.segs.length; i++) parts.push(fitToD(c.segs[i], p, i === 0));
  if (c.closed) parts.push('Z');
  return parts.join('');
}

export function shapeToElement(s: Shape, o: Required<EmitOptions>): string {
  const p = o.precision;
  const anno = o.annotate
    ? ` data-shape-id="${s.id}" data-confidence="${s.meta.confidence.toFixed(2)}" data-max-dev="${s.meta.maxDev.toExponential(2)}" data-from="${s.meta.from.join(',')}"${s.meta.note ? ` data-note="${s.meta.note}"` : ''}`
    : '';
  const st = styleAttrs(s.style, p);

  switch (s.kind) {
    case 'circle':
      return `<circle cx="${fmt(s.c.x, p)}" cy="${fmt(s.c.y, p)}" r="${fmt(s.r, p)}" ${st}${anno}/>`;
    case 'ellipse': {
      const rot = s.rot === 0 ? '' : ` transform="rotate(${fmt((s.rot * 180) / Math.PI, p)} ${fmt(s.c.x, p)} ${fmt(s.c.y, p)})"`;
      return `<ellipse cx="${fmt(s.c.x, p)}" cy="${fmt(s.c.y, p)}" rx="${fmt(s.rx, p)}" ry="${fmt(s.ry, p)}"${rot} ${st}${anno}/>`;
    }
    case 'rect': {
      const rx = s.rx > 0 ? ` rx="${fmt(s.rx, p)}"` : '';
      const rot =
        Math.abs(s.rot) < 1e-9
          ? ''
          : ` transform="rotate(${fmt((s.rot * 180) / Math.PI, p)} ${fmt(s.x, p)} ${fmt(s.y, p)})"`;
      // rotate(a, x, y) pins the local origin, so x/y stay the rect's own corner.
      return `<rect x="${fmt(s.x, p)}" y="${fmt(s.y, p)}" width="${fmt(s.w, p)}" height="${fmt(s.h, p)}"${rx}${rot} ${st}${anno}/>`;
    }
    case 'line':
      return `<line x1="${fmt(s.a.x, p)}" y1="${fmt(s.a.y, p)}" x2="${fmt(s.b.x, p)}" y2="${fmt(s.b.y, p)}" ${st}${anno}/>`;
    case 'polygon': {
      const pts = s.pts.map((q) => `${fmt(q.x, p)},${fmt(q.y, p)}`).join(' ');
      return `<polygon points="${pts}" ${st}${anno}/>`;
    }
    case 'path': {
      // Holes keep the source winding, so nonzero still cuts them correctly.
      const d = s.contours.map((c) => contourToD(c, p)).join('');
      return `<path d="${d}" ${st}${anno}/>`;
    }
    case 'text': {
      const anchor = s.anchor !== 'start' ? ` text-anchor="${s.anchor}"` : '';
      const fill = `fill="${s.style.fill ?? 'black'}"`;
      return (
        `<text x="${fmt(s.p.x, p)}" y="${fmt(s.p.y, p)}" font-size="${fmt(s.fontSize, p)}"` +
        ` font-family="${escXML(s.fontFamily)}"${anchor} ${fill}${anno}>${escXML(s.text)}</text>`
      );
    }
  }
}

export function sceneToSVG(scene: Scene, opts: EmitOptions = {}): string {
  const o: Required<EmitOptions> = { precision: opts.precision ?? 3, annotate: opts.annotate ?? false };
  const vb = scene.viewBox.map((v) => fmt(v, 4)).join(' ');
  const body = scene.shapes.map((s) => '  ' + shapeToElement(s, o)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(scene.width, 4)}" height="${fmt(scene.height, 4)}" viewBox="${vb}">\n${body}\n</svg>\n`;
}

const refStr = (r: SegRef): string => `${r.shape}.${r.seg}`;
const degStr = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(1)}deg`;

/**
 * The per-segment table for one path shape: the construction values a designer
 * would write down — each radius, each sweep, and whether each join is tangent.
 */
function segTable(scene: Scene, shapeId: string): string[] {
  const rows = scene.construction?.segs.filter((n) => n.ref.shape === shapeId) ?? [];
  if (!rows.length) return [];
  const L = ['         seg  kind    value                                relation'];
  for (const n of rows) {
    const idx = String(n.ref.seg).padEnd(4);
    L.push(`         ${idx} ${n.kind.padEnd(7)} ${n.value.padEnd(36)} ${n.relation}`);
  }
  return L;
}

/** Human-readable construction listing — the "what did it find" view. */
export function sceneToText(scene: Scene): string {
  const L: string[] = [];
  const f = (v: number): string => v.toFixed(2);
  for (const s of scene.shapes) {
    const conf = `${(s.meta.confidence * 100).toFixed(0)}%`;
    const stroke = s.style.stroke ? ` stroke=${f(s.style.strokeWidth ?? 0)}` : '';
    switch (s.kind) {
      case 'circle':
        L.push(`${s.id}  Circle   center(${f(s.c.x)}, ${f(s.c.y)}) r=${f(s.r)}${stroke}  [${conf}]`);
        break;
      case 'ellipse':
        L.push(`${s.id}  Ellipse  center(${f(s.c.x)}, ${f(s.c.y)}) rx=${f(s.rx)} ry=${f(s.ry)} rot=${f((s.rot * 180) / Math.PI)}deg  [${conf}]`);
        break;
      case 'rect':
        L.push(`${s.id}  Rect     ${f(s.w)}x${f(s.h)} at (${f(s.x)}, ${f(s.y)})${s.rx > 0 ? ` r=${f(s.rx)}` : ''}${Math.abs(s.rot) > 1e-9 ? ` rot=${f((s.rot * 180) / Math.PI)}deg` : ''}  [${conf}]`);
        break;
      case 'line':
        L.push(`${s.id}  Line     (${f(s.a.x)}, ${f(s.a.y)}) -> (${f(s.b.x)}, ${f(s.b.y)}) len=${f(dist(s.a, s.b))}${stroke}  [${conf}]`);
        break;
      case 'polygon':
        L.push(`${s.id}  Polygon  ${s.sides} sides, center(${f(s.c.x)}, ${f(s.c.y)}) r=${f(s.r)}  [${conf}]`);
        break;
      case 'path': {
        const counts: Record<string, number> = {};
        for (const c of s.contours) for (const g of c.segs) counts[g.kind] = (counts[g.kind] ?? 0) + 1;
        const desc = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
        const holes = s.contours.filter((c) => c.hole).length;
        const caps = s.style.stroke ? ` ${s.style.strokeLinecap ?? 'butt'}/${s.style.strokeLinejoin ?? 'miter'}` : '';
        L.push(`${s.id}  Path     ${desc}${holes ? `, ${holes} hole(s)` : ''}${stroke}${caps}  [${conf}]`);
        break;
      }
      case 'text':
        L.push(`${s.id}  Text     "${s.text}" at (${f(s.p.x)}, ${f(s.p.y)}) size=${f(s.fontSize)} ${s.anchor}  [${conf}]`);
        break;
    }
    if (s.meta.note) L.push(`         ${s.meta.note}`);
    if (s.kind === 'path') L.push(...segTable(scene, s.id));
  }
  if (scene.constraints.length) {
    L.push('', 'Constraints:');
    // Corners are already spelled out per segment in the table above, so they
    // are summarized here rather than repeated one line per kink.
    const corners = scene.constraints.filter((c) => c.kind === 'corner') as Extract<
      Scene['constraints'][number],
      { kind: 'corner' }
    >[];
    const semis = scene.constraints.filter((c) => c.kind === 'semicircle') as Extract<
      Scene['constraints'][number],
      { kind: 'semicircle' }
    >[];
    for (const c of scene.constraints) {
      switch (c.kind) {
        case 'equal-radius':
          L.push(`  equal-radius(${c.ids.join(', ')}) = ${f(c.value)}`);
          break;
        case 'concentric':
        case 'concentric-with':
          L.push(`  concentric(${c.ids.join(', ')}) at (${f(c.c.x)}, ${f(c.c.y)})`);
          break;
        case 'aligned-h':
          L.push(`  aligned-h(${c.ids.join(', ')}) y=${f(c.y)}`);
          break;
        case 'aligned-v':
          L.push(`  aligned-v(${c.ids.join(', ')}) x=${f(c.x)}`);
          break;
        case 'reflection':
          L.push(`  reflection about ${c.axis.dir.x === 0 ? `x=${f(c.axis.p.x)}` : `y=${f(c.axis.p.y)}`}`);
          break;
        case 'rotational':
          L.push(`  rotational order ${c.order} about (${f(c.c.x)}, ${f(c.c.y)})`);
          break;
        case 'tangent':
          L.push(
            `  tangent(${refStr(c.a)} -> ${refStr(c.b)}) residual ${c.residual.toExponential(1)} rad` +
              (c.solved ? '  [solved: line tangent to arc]' : ''),
          );
          break;
        case 'equal-radius-seg':
          L.push(`  equal-radius(${c.segs.map(refStr).join(', ')}) = ${c.value.toFixed(3)}  [reported, not snapped]`);
          break;
        case 'aspect':
          L.push(`  aspect ${c.ratio.toFixed(4)}:1${c.tight ? '   ink bbox == viewBox' : ''}`);
          break;
        case 'corner':
        case 'semicircle':
          break; // summarized below
      }
    }
    if (semis.length) L.push(`  semicircle(${semis.map((c) => refStr(c.seg)).join(', ')})`);
    if (corners.length) {
      const angles = corners.map((c) => c.angle).sort((a, b) => b - a);
      L.push(`  corners: ${corners.length} join(s), ${degStr(angles[0])} down to ${degStr(angles[angles.length - 1])}`);
    }
  }
  if (scene.construction?.strokes.length) {
    L.push('', 'Stroke:');
    for (const k of scene.construction.strokes) {
      L.push(`  w=${f(k.width)} = ${(k.ofHeight * 100).toFixed(1)}% of ink height, ${k.cap}/${k.join}`);
    }
  }
  const r = scene.report;
  L.push(
    '',
    `tol=${r.tol.toExponential(2)}  maxDev=${r.maxDev.toExponential(2)}  ` +
      `coverage=${(r.primitiveCoverage * 100).toFixed(1)}%  regions=${r.sourceRegions} -> shapes=${scene.shapes.length}`,
  );
  return L.join('\n');
}
