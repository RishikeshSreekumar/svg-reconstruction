import type { Pt, Scene, Shape, Style } from '../types.ts';
import { editShapeParams, rebuildConstruction, refreshPolygon, translateShape, type EditOptions, type ShapeEditResult } from './index.ts';

export type CreatableKind = 'circle' | 'ellipse' | 'rect' | 'line' | 'polygon' | 'text';

export interface CreateOptions {
  /** Characteristic size in user units. Default: 12% of the viewBox's short side. */
  size?: number;
  text?: string;
  style?: Style;
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
