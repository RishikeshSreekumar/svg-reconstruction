import type { BBox, Contour, CubicFit, Cutout, Fit, Pt, Scene, Shape, Style } from '../types.ts';
import { sampleFit } from '../fit/primitives.ts';
import { bboxOf } from '../geom/poly.ts';
import { syncCubic } from '../geom/seg.ts';
import { editShapeParams, rebuildConstruction, refreshPolygon, translateShape, type EditOptions, type ShapeEditResult } from './index.ts';

export type CreatableKind = 'circle' | 'ellipse' | 'rect' | 'line' | 'polygon' | 'curve' | 'text';

export interface CreateOptions {
  /** Characteristic size in user units. Default: 12% of the viewBox's short side. */
  size?: number;
  text?: string;
  style?: Style;
}

export interface CutResult {
  applied: boolean;
  targetId?: string;
  reason?: string;
}

/**
 * Mint an id in the user namespace. Reconstruct's own counter resets per run
 * and hands out `s0…`, so user shapes get `u0…` — found by scanning, which
 * keeps the scheme stateless across undo snapshots and reloads.
 */
export function nextUserId(scene: Scene): string {
  let max = -1;
  for (const s of scene.shapes) {
    const m = /^u(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `u${max + 1}`;
}

/** Same scheme for user guidelines: `ug0…`, disjoint from inferred `g0…`. */
export function nextUserGuideId(scene: Scene): string {
  let max = -1;
  for (const g of scene.guidelines ?? []) {
    const m = /^ug(\d+)$/.exec(g.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ug${max + 1}`;
}

/** Create a shape at `at` with editor defaults and append it to the paint order. */
export function createShape(scene: Scene, kind: CreatableKind, at: Pt, opts: CreateOptions = {}): Shape {
  const short = Math.min(scene.viewBox[2], scene.viewBox[3]) || 100;
  const size = opts.size ?? short * 0.12;
  const stroke = Math.max(size * 0.06, short * 0.004);
  const line: Style = { fill: null, stroke: 'black', strokeWidth: stroke };
  const meta = { confidence: 1, maxDev: 0, from: [], note: 'user' };
  const id = nextUserId(scene);

  let s: Shape;
  switch (kind) {
    case 'circle':
      s = { kind, id, c: { ...at }, r: size / 2, style: opts.style ?? line, meta };
      break;
    case 'ellipse':
      s = { kind, id, c: { ...at }, rx: size / 2, ry: size / 3, rot: 0, style: opts.style ?? line, meta };
      break;
    case 'rect':
      s = { kind, id, x: at.x - size / 2, y: at.y - size / 3, w: size, h: (size * 2) / 3, rx: 0, rot: 0, style: opts.style ?? line, meta };
      break;
    case 'line':
      s = { kind, id, a: { x: at.x - size / 2, y: at.y }, b: { x: at.x + size / 2, y: at.y }, style: opts.style ?? line, meta };
      break;
    case 'polygon': {
      s = { kind, id, pts: [], sides: 6, c: { ...at }, r: size / 2, rot: -Math.PI / 2, style: opts.style ?? line, meta };
      refreshPolygon(s);
      break;
    }
    case 'curve': {
      const a = { x: at.x - size / 2, y: at.y };
      const b = { x: at.x + size / 2, y: at.y };
      s = { kind: 'path', id, contours: [{ segs: [bezierSeg(a, b)], closed: false, hole: false }], style: opts.style ?? line, meta };
      break;
    }
    case 'text':
      s = {
        kind,
        id,
        p: { ...at },
        text: opts.text ?? 'Text',
        fontSize: size / 2,
        fontFamily: 'sans-serif',
        anchor: 'start',
        style: opts.style ?? { fill: 'black', stroke: null },
        meta,
      };
      break;
  }
  scene.shapes.push(s);
  return s;
}

/**
 * An authored bezier from `a` to `b`, with its control legs at the classic
 * thirds and a gentle S so the two handles are visibly separate from the ends.
 */
function bezierSeg(a: Pt, b: Pt): CubicFit {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Perpendicular bow, a quarter of the chord each way.
  const px = -dy / 4;
  const py = dx / 4;
  const f: CubicFit = {
    kind: 'cubic',
    pts: [{ ...a }, { ...b }],
    c1: { x: a.x + dx / 3 + px, y: a.y + dy / 3 + py },
    c2: { x: a.x + (2 * dx) / 3 - px, y: a.y + (2 * dy) / 3 - py },
    maxDev: 0,
    rmsDev: 0,
    params: 8,
  };
  syncCubic(f);
  return f;
}

/** Re-span a freshly drawn curve from `a` to `b` while its size drag runs. */
export function sizeCurve(scene: Scene, id: string, a: Pt, b: Pt): boolean {
  const s = scene.shapes.find((x) => x.id === id);
  if (s?.kind !== 'path' || s.contours[0]?.segs[0]?.kind !== 'cubic') return false;
  s.contours[0].segs[0] = bezierSeg(a, b);
  return true;
}

/**
 * Remove a shape and every constraint that mentions it, then re-derive the
 * construction table. A constraint that no longer relates two things is not a
 * constraint.
 */
export function deleteShape(scene: Scene, id: string): boolean {
  const i = scene.shapes.findIndex((s) => s.id === id);
  if (i < 0) return false;
  scene.shapes.splice(i, 1);
  scene.constraints = scene.constraints.filter((c) => {
    switch (c.kind) {
      case 'equal-radius':
      case 'concentric':
      case 'concentric-with':
      case 'aligned-h':
      case 'aligned-v':
      case 'reflection':
      case 'rotational':
        c.ids = c.ids.filter((x) => x !== id);
        return c.ids.length >= 2;
      case 'tangent':
      case 'corner':
        return c.a.shape !== id && c.b.shape !== id;
      case 'equal-radius-seg':
        c.segs = c.segs.filter((s) => s.shape !== id);
        return c.segs.length >= 2;
      case 'semicircle':
        return c.seg.shape !== id;
      case 'aspect':
        return true;
    }
  });
  rebuildConstruction(scene);
  return true;
}

export interface BreakResult {
  applied: boolean;
  /** Ids of the fragments, in paint order. */
  ids: string[];
  reason?: string;
}

/**
 * An open fragment cannot paint its fill, so it inherits the path's stroke —
 * or, for a fill-only path, trades the fill for a visible stroke.
 */
function openFragStyle(scene: Scene, st: Style): Style {
  if (st.stroke) return { ...st, fill: null };
  const short = Math.min(scene.viewBox[2], scene.viewBox[3]) || 100;
  return { ...st, fill: null, stroke: st.fill ?? 'black', strokeWidth: short * 0.008 };
}

/** The most specific standalone shape one fitted segment can become. Id is filled in by the caller. */
function segToShape(f: Fit, closedStyle: Style, openStyle: Style, meta: Shape['meta']): Shape {
  switch (f.kind) {
    case 'line':
      return { kind: 'line', id: '', a: { ...f.a }, b: { ...f.b }, style: openStyle, meta };
    case 'circle':
      return { kind: 'circle', id: '', c: { ...f.c }, r: f.r, style: closedStyle, meta };
    case 'ellipse':
      return { kind: 'ellipse', id: '', c: { ...f.c }, rx: f.rx, ry: f.ry, rot: f.rot, style: closedStyle, meta };
    default:
      return { kind: 'path', id: '', contours: [{ segs: [structuredClone(f)], closed: false, hole: false }], style: openStyle, meta };
  }
}

/**
 * Break a path into independently editable pieces: a multi-contour path splits
 * into one shape per contour, a single contour splits into one shape per
 * segment. This is the escape hatch when the chain solver's coupling is not
 * wanted — a detached arc edits as its own arc, free of its old neighbours.
 */
export function breakApartShape(scene: Scene, id: string): BreakResult {
  const idx = scene.shapes.findIndex((s) => s.id === id);
  const s = scene.shapes[idx];
  if (!s || s.kind !== 'path') return { applied: false, ids: [], reason: 'only paths can be broken apart' };
  if (s.cutouts?.length) return { applied: false, ids: [], reason: 'remove its holes first — a broken shape cannot keep them' };

  const meta = (): Shape['meta'] => ({ confidence: 1, maxDev: 0, from: [...s.meta.from], note: `broken from ${id}` });
  const pieces: Shape[] = [];
  if (s.contours.length > 1) {
    for (const c of s.contours) {
      const contour: Contour = { segs: c.segs.map((f) => structuredClone(f)), closed: c.closed, hole: false };
      const style = c.closed ? { ...s.style } : openFragStyle(scene, s.style);
      pieces.push({ kind: 'path', id: '', contours: [contour], style, meta: meta() });
    }
  } else {
    const c = s.contours[0];
    if (!c || c.segs.length < 2) return { applied: false, ids: [], reason: 'already a single segment' };
    const open = openFragStyle(scene, s.style);
    for (const f of c.segs) pieces.push(segToShape(f, { ...s.style }, open, meta()));
  }

  const ids: string[] = [];
  pieces.forEach((shape, k) => {
    shape.id = nextUserId(scene);
    ids.push(shape.id);
    scene.shapes.splice(idx + k, 0, shape);
  });
  deleteShape(scene, id);
  return { applied: true, ids };
}

/** True when a shape has a closed outline that can participate in subtraction. */
export function isCuttableShape(s: Shape): boolean {
  return (
    s.kind === 'circle' ||
    s.kind === 'ellipse' ||
    s.kind === 'rect' ||
    s.kind === 'polygon' ||
    (s.kind === 'path' && s.contours.some((c) => c.closed))
  );
}

function rotated(p: Pt, about: Pt, a: number): Pt {
  if (Math.abs(a) < 1e-12) return { ...p };
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = p.x - about.x;
  const y = p.y - about.y;
  return { x: about.x + c * x - s * y, y: about.y + s * x + c * y };
}

function geometryPoints(s: Shape | Cutout): Pt[] {
  switch (s.kind) {
    case 'circle':
      return [
        { x: s.c.x - s.r, y: s.c.y },
        { x: s.c.x + s.r, y: s.c.y },
        { x: s.c.x, y: s.c.y - s.r },
        { x: s.c.x, y: s.c.y + s.r },
      ];
    case 'ellipse':
      return Array.from({ length: 32 }, (_, i) => {
        const a = (2 * Math.PI * i) / 32;
        return rotated({ x: s.c.x + s.rx * Math.cos(a), y: s.c.y + s.ry * Math.sin(a) }, s.c, s.rot);
      });
    case 'rect': {
      const p = { x: s.x, y: s.y };
      return [
        { x: s.x, y: s.y },
        { x: s.x + s.w, y: s.y },
        { x: s.x + s.w, y: s.y + s.h },
        { x: s.x, y: s.y + s.h },
      ].map((q) => rotated(q, p, s.rot));
    }
    case 'polygon':
      return s.pts;
    case 'path':
      return s.contours.flatMap((c) => c.segs.flatMap((f) => sampleFit(f, 24)));
    case 'line':
      return [s.a, s.b];
    case 'text':
      return [s.p];
  }
}

/** Axis-aligned bounds of a shape's or cutout's geometry. */
export function shapeBBox(s: Shape | Cutout): BBox | null {
  const pts = geometryPoints(s);
  return pts.length ? bboxOf(pts) : null;
}

function overlaps(a: Shape, b: Shape): boolean {
  const x = shapeBBox(a);
  const y = shapeBBox(b);
  return !!x && !!y && x.x0 <= y.x1 && x.x1 >= y.x0 && x.y0 <= y.y1 && x.y1 >= y.y0;
}

function asCutout(s: Shape): Cutout | null {
  switch (s.kind) {
    case 'circle':
      return { kind: s.kind, c: { ...s.c }, r: s.r };
    case 'ellipse':
      return { kind: s.kind, c: { ...s.c }, rx: s.rx, ry: s.ry, rot: s.rot };
    case 'rect':
      return { kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, rx: s.rx, rot: s.rot };
    case 'polygon':
      return { kind: s.kind, pts: s.pts.map((p) => ({ ...p })) };
    case 'path':
      return s.contours.some((c) => c.closed)
        ? { kind: s.kind, contours: structuredClone(s.contours), fillRule: s.style.fillRule }
        : null;
    case 'line':
    case 'text':
      return null;
  }
}

/**
 * Find the nearest overlapping closed shape behind `cutterId` in paint order.
 * This is the studio's "subtract front" target and keeps the interaction to a
 * single, reversible action.
 */
export function findCutTarget(scene: Scene, cutterId: string): string | null {
  const i = scene.shapes.findIndex((s) => s.id === cutterId);
  if (i < 0) return null;
  const cutter = scene.shapes[i];
  if (!isCuttableShape(cutter) || cutter.cutouts?.length) return null;
  for (let j = i - 1; j >= 0; j--) {
    const target = scene.shapes[j];
    if (isCuttableShape(target) && overlaps(cutter, target)) return target.id;
  }
  return null;
}

/**
 * Subtract one closed shape from another. The cutter is removed from the paint
 * stack and captured as editable scene data on the target; undo restores both.
 */
export function cutShape(scene: Scene, cutterId: string, targetId = findCutTarget(scene, cutterId) ?? ''): CutResult {
  const cutter = scene.shapes.find((s) => s.id === cutterId);
  const target = scene.shapes.find((s) => s.id === targetId);
  if (!cutter || !target || cutter === target) return { applied: false, reason: 'place a closed cutter over a shape below it' };
  // Subtraction removes what the cutter paints over, so the target must sit
  // behind the cutter — the auto-target search guarantees this, an explicit
  // target has to be checked.
  if (scene.shapes.indexOf(target) > scene.shapes.indexOf(cutter)) {
    return { applied: false, reason: 'the target sits in front of the cutter — reorder them first' };
  }
  if (!isCuttableShape(target)) return { applied: false, reason: 'the target needs a closed outline' };
  if (cutter.cutouts?.length) return { applied: false, reason: 'a shape with cutouts cannot be used as a cutter yet' };
  const cutout = asCutout(cutter);
  if (!cutout || !overlaps(cutter, target)) return { applied: false, reason: 'the cutter does not overlap the target' };
  // Replace the array rather than pushing into it: consumers hold shallow
  // clones of the shape, so an in-place push is invisible to them.
  target.cutouts = [...(target.cutouts ?? []), cutout];
  target.meta.confidence = 1;
  target.meta.maxDev = 0;
  deleteShape(scene, cutterId);
  return { applied: true, targetId: target.id };
}

/**
 * Translate a whole shape by a delta, routed through the parameter editor
 * wherever whole-shape fields exist so constraint propagation still applies.
 */
export function translateShapeInScene(scene: Scene, id: string, dx: number, dy: number, opts: EditOptions = {}): ShapeEditResult {
  const s = scene.shapes.find((x) => x.id === id);
  const out: ShapeEditResult = { applied: false, linked: [] };
  if (!s || !Number.isFinite(dx) || !Number.isFinite(dy)) return out;
  switch (s.kind) {
    case 'circle':
    case 'ellipse':
    case 'polygon':
      return editShapeParams(scene, id, { 'c.x': s.c.x + dx, 'c.y': s.c.y + dy }, opts);
    case 'rect':
      return editShapeParams(scene, id, { x: s.x + dx, y: s.y + dy }, opts);
    case 'line':
      return editShapeParams(scene, id, { 'a.x': s.a.x + dx, 'a.y': s.a.y + dy, 'b.x': s.b.x + dx, 'b.y': s.b.y + dy }, opts);
    case 'text':
      return editShapeParams(scene, id, { 'p.x': s.p.x + dx, 'p.y': s.p.y + dy }, opts);
    case 'path':
      // No whole-shape fields exist for a path; move the geometry directly.
      translateShape(s, dx, dy);
      s.meta.confidence = 1;
      s.meta.maxDev = 0;
      out.applied = true;
      return out;
  }
}

/** Reorder within `scene.shapes`, which is the paint order. */
export function reorderShape(scene: Scene, id: string, dir: 'forward' | 'backward' | 'front' | 'back'): boolean {
  const i = scene.shapes.findIndex((s) => s.id === id);
  if (i < 0) return false;
  const [s] = scene.shapes.splice(i, 1);
  const j =
    dir === 'front' ? scene.shapes.length : dir === 'back' ? 0 : dir === 'forward' ? Math.min(i + 1, scene.shapes.length) : Math.max(i - 1, 0);
  scene.shapes.splice(j, 0, s);
  return true;
}
