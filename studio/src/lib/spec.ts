import type { Fit, Pt, Scene, SegRef } from '../../../src/types.ts';
import { segEnd } from '../../../src/index.ts';

/**
 * The spec sheet's data model: the construction grouped by fact — radii,
 * joins, proportions — rather than by shape. Everything here is derived per
 * rev from `scene.construction` and `scene.constraints`; values are the
 * engine's measured numbers, never rounded in the model (display rounds).
 */

/** Geometry a hovered spec row asks the canvas to draw. */
export interface SpecHighlight {
  circles?: { c: Pt; r: number }[];
  points?: Pt[];
  /** Infinite axis through p along dir (mirror axes). */
  axis?: { p: Pt; dir: Pt };
  /** x, y, w, h — the ink bbox. */
  box?: [number, number, number, number];
  label?: string;
  /** Label anchor in user units. */
  at?: Pt;
}

export interface RadiusRow {
  label: string; // R1, R2, …
  value: number;
  /** Member chips, e.g. "u3.2" (segment) or "u1" (whole shape). */
  members: { text: string; shape: string; seg?: SegRef }[];
  highlight: SpecHighlight;
}

export interface JoinRow {
  kind: 'tangent' | 'corner';
  a: SegRef;
  b: SegRef;
  /** Tangency residual in radians (tangent) or exterior angle in degrees (corner). */
  value: number;
  solved: boolean;
  highlight: SpecHighlight;
}

export interface FactRow {
  name: string;
  value: string;
  detail?: string;
  highlight?: SpecHighlight;
}

export interface SpecModel {
  radii: RadiusRow[];
  joins: JoinRow[];
  facts: FactRow[];
}

const refKey = (r: SegRef): string => `${r.shape}#${r.contour}.${r.seg}`;
const chip = (r: SegRef): string => `${r.shape}.${r.seg}`;

function fitOf(scene: Scene, ref: SegRef): Fit | null {
  const shape = scene.shapes.find((s) => s.id === ref.shape);
  if (!shape || shape.kind !== 'path') return null;
  return shape.contours[ref.contour]?.segs[ref.seg] ?? null;
}

function circleOf(scene: Scene, ref: SegRef): { c: Pt; r: number } | null {
  const f = fitOf(scene, ref);
  return f && (f.kind === 'arc' || f.kind === 'circle') ? { c: f.c, r: f.r } : null;
}

const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();

function radiusHighlight(circles: { c: Pt; r: number }[], label: string): SpecHighlight {
  const top = circles[0];
  return {
    circles,
    points: circles.map((x) => x.c),
    label,
    at: top ? { x: top.c.x, y: top.c.y - top.r } : undefined,
  };
}

/**
 * Group every measured radius. Seg-level equal-radius groups come from the
 * detector; leftover arcs and whole circles become singleton rows. Numbering
 * follows occurrence order (shapes in scene order, then segments in
 * construction order), never value order, so labels stay put across edits.
 */
function buildRadii(scene: Scene): RadiusRow[] {
  const rows: Omit<RadiusRow, 'label'>[] = [];
  const inSegGroup = new Set<string>();
  const inShapeGroup = new Set<string>();

  for (const c of scene.constraints) {
    if (c.kind === 'equal-radius-seg') {
      for (const s of c.segs) inSegGroup.add(refKey(s));
      const circles = c.segs.map((s) => circleOf(scene, s)).filter((x): x is { c: Pt; r: number } => !!x);
      rows.push({
        value: c.value,
        members: c.segs.map((s) => ({ text: chip(s), shape: s.shape, seg: s })),
        highlight: radiusHighlight(circles, ''),
      });
    } else if (c.kind === 'equal-radius') {
      for (const id of c.ids) inShapeGroup.add(id);
      const circles = c.ids
        .map((id) => scene.shapes.find((s) => s.id === id))
        .filter((s): s is Extract<Scene['shapes'][number], { kind: 'circle' }> => !!s && s.kind === 'circle')
        .map((s) => ({ c: s.c, r: s.r }));
      rows.push({
        value: c.value,
        members: c.ids.map((id) => ({ text: id, shape: id })),
        highlight: radiusHighlight(circles, ''),
      });
    }
  }

  // Singleton whole-shape circles, in scene order.
  for (const s of scene.shapes) {
    if (s.kind === 'circle' && !inShapeGroup.has(s.id)) {
      rows.push({
        value: s.r,
        members: [{ text: s.id, shape: s.id }],
        highlight: radiusHighlight([{ c: s.c, r: s.r }], ''),
      });
    }
  }

  // Singleton arc segments, in construction order.
  for (const n of scene.construction?.segs ?? []) {
    if (n.r == null || inSegGroup.has(refKey(n.ref))) continue;
    const circ = circleOf(scene, n.ref);
    if (!circ) continue;
    rows.push({
      value: n.r,
      members: [{ text: chip(n.ref), shape: n.ref.shape, seg: n.ref }],
      highlight: radiusHighlight([circ], ''),
    });
  }

  return rows.map((r, i) => {
    const label = `R${i + 1}`;
    r.highlight.label = `${label} = ${fmt(r.value)}`;
    return { ...r, label };
  });
}

function buildJoins(scene: Scene): JoinRow[] {
  const rows: JoinRow[] = [];
  for (const c of scene.constraints) {
    if (c.kind !== 'tangent' && c.kind !== 'corner') continue;
    const fa = fitOf(scene, c.a);
    const p = fa ? segEnd(fa) : null;
    const circles = [c.a, c.b].map((s) => circleOf(scene, s)).filter((x): x is { c: Pt; r: number } => !!x);
    const tangent = c.kind === 'tangent';
    rows.push({
      kind: c.kind,
      a: c.a,
      b: c.b,
      value: tangent ? c.residual : (c.angle * 180) / Math.PI,
      solved: tangent ? c.solved : false,
      highlight: {
        circles,
        points: p ? [p] : [],
        label: tangent ? `tangent${c.solved ? ' (solved)' : ''}` : `corner ${fmt((c.angle * 180) / Math.PI)}°`,
        at: p ?? undefined,
      },
    });
  }
  // Tangents lead — they are the construction story; corners follow.
  return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'tangent' ? -1 : 1));
}

function buildFacts(scene: Scene): FactRow[] {
  const facts: FactRow[] = [];
  const con = scene.construction;
  if (con) {
    const { x0, y0, x1, y1 } = con.ink;
    facts.push({
      name: 'aspect',
      value: `${con.aspect.toFixed(4)}:1`,
      detail: con.tightViewBox ? 'ink fills viewBox' : undefined,
      highlight: { box: [x0, y0, x1 - x0, y1 - y0], label: 'ink bbox', at: { x: (x0 + x1) / 2, y: y0 } },
    });
    for (const s of con.strokes) {
      facts.push({
        name: 'stroke',
        value: fmt(s.width),
        detail: `${s.ofHeight.toFixed(3)} × ink height · ${s.cap} cap, ${s.join} join`,
      });
    }
  }
  for (const c of scene.constraints) {
    switch (c.kind) {
      case 'reflection': {
        const vertical = c.axis.dir.x === 0;
        facts.push({
          name: 'mirror',
          value: vertical ? `x = ${fmt(c.axis.p.x)}` : `y = ${fmt(c.axis.p.y)}`,
          detail: c.ids.join(', '),
          highlight: { axis: c.axis, label: 'mirror axis', at: c.axis.p },
        });
        break;
      }
      case 'rotational':
        facts.push({
          name: 'rotational',
          value: `order ${c.order}`,
          detail: `about (${fmt(c.c.x)}, ${fmt(c.c.y)})`,
          highlight: { points: [c.c], label: `rotation centre ×${c.order}`, at: c.c },
        });
        break;
      case 'concentric':
      case 'concentric-with':
        facts.push({
          name: 'concentric',
          value: `(${fmt(c.c.x)}, ${fmt(c.c.y)})`,
          detail: c.ids.join(', '),
          highlight: { points: [c.c], label: 'shared centre', at: c.c },
        });
        break;
      case 'aligned-h':
        facts.push({
          name: 'aligned',
          value: `y = ${fmt(c.y)}`,
          detail: c.ids.join(', '),
          highlight: { axis: { p: { x: 0, y: c.y }, dir: { x: 1, y: 0 } }, label: 'alignment', at: { x: scene.viewBox[0] + scene.viewBox[2] / 2, y: c.y } },
        });
        break;
      case 'aligned-v':
        facts.push({
          name: 'aligned',
          value: `x = ${fmt(c.x)}`,
          detail: c.ids.join(', '),
          highlight: { axis: { p: { x: c.x, y: 0 }, dir: { x: 0, y: 1 } }, label: 'alignment', at: { x: c.x, y: scene.viewBox[1] + scene.viewBox[3] / 2 } },
        });
        break;
    }
  }
  return facts;
}

export function buildSpec(scene: Scene): SpecModel {
  return { radii: buildRadii(scene), joins: buildJoins(scene), facts: buildFacts(scene) };
}
