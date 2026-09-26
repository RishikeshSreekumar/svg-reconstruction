import type { Constraint, Contour, Cutout, Fit, Options, Pt, Scene, SegRef, Shape } from '../types.ts';
import { DEFAULTS } from '../types.ts';
import { dist, dot, len, norm, sub } from '../geom/vec.ts';
import { isBezier, segEnd, segStart, syncArcEnds, syncCubic } from '../geom/seg.ts';
import { captureJoins, maxGap, placeCubicEnd, refitArcRadius, solveContour, type JoinSpec } from './solve.ts';
import { analyzeConstruction } from '../infer/construction.ts';

export { captureJoins, maxGap, refitArcRadius, solveContour, type JoinSpec, type JoinIntent } from './solve.ts';

/** One editable number, as the UI should show it. */
export interface Field {
  key: string;
  label: string;
  value: number;
  /** True when the value is shown in degrees but stored in radians. */
  deg?: boolean;
}

export interface EditOptions {
  /** Propagate the edit through detected constraints. */
  enforce?: boolean;
  g1Tol?: number;
  /** Tolerance used when re-deriving the construction listing. */
  tol?: number;
  /**
   * Refuse an edit that leaves a gap wider than this at the far side of a
   * closed contour. A loop of tangent arcs is over-determined — every radius
   * cannot be free — so past some point the only way to honour a new radius is
   * to tear the outline open, and a torn outline is worse than a refused edit.
   */
  maxResidual?: number;
}

export interface ShapeEditResult {
  applied: boolean;
  /** Other shapes moved or resized to preserve a detected relationship. */
  linked: string[];
}

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

// ---------------------------------------------------------------------------
// What can be edited
// ---------------------------------------------------------------------------

/** Editable parameters of a whole shape, addressed by dotted path. */
export function shapeFields(s: Shape): Field[] {
  const out: Field[] = [];
  const f = (key: string, label: string, value: number, d?: boolean): void => {
    out.push({ key, label, value, deg: d });
  };
  switch (s.kind) {
    case 'circle':
      f('c.x', 'cx', s.c.x), f('c.y', 'cy', s.c.y), f('r', 'r', s.r);
      break;
    case 'ellipse':
      f('c.x', 'cx', s.c.x), f('c.y', 'cy', s.c.y), f('rx', 'rx', s.rx), f('ry', 'ry', s.ry);
      f('rot', 'rot', deg(s.rot), true);
      break;
    case 'rect':
      f('x', 'x', s.x), f('y', 'y', s.y), f('w', 'w', s.w), f('h', 'h', s.h), f('rx', 'rx', s.rx);
      f('rot', 'rot', deg(s.rot), true);
      break;
    case 'polygon':
      f('c.x', 'cx', s.c.x), f('c.y', 'cy', s.c.y), f('r', 'r', s.r), f('sides', 'sides', s.sides);
      f('rot', 'rot', deg(s.rot), true);
      break;
    case 'line':
      f('a.x', 'x1', s.a.x), f('a.y', 'y1', s.a.y), f('b.x', 'x2', s.b.x), f('b.y', 'y2', s.b.y);
      break;
    case 'path':
      break; // edited per segment
    case 'text':
      f('p.x', 'x', s.p.x), f('p.y', 'y', s.p.y), f('fontSize', 'size', s.fontSize);
      break;
  }
  if (s.style.stroke) f('style.strokeWidth', 'stroke', s.style.strokeWidth ?? 0);
  return out;
}

/**
 * Editable parameters of one fitted segment — the values a construction table
 * lists, rather than the coordinates a `d` attribute spells out.
 */
export function segmentFields(f: Fit): Field[] {
  switch (f.kind) {
    case 'arc':
      return [
        { key: 'r', label: 'r', value: f.r },
        { key: 'cx', label: 'cx', value: f.c.x },
        { key: 'cy', label: 'cy', value: f.c.y },
        { key: 'sweep', label: 'sweep', value: deg(f.a1 - f.a0), deg: true },
      ];
    case 'line':
      return [
        { key: 'x1', label: 'x1', value: f.a.x },
        { key: 'y1', label: 'y1', value: f.a.y },
        { key: 'x2', label: 'x2', value: f.b.x },
        { key: 'y2', label: 'y2', value: f.b.y },
        { key: 'len', label: 'len', value: dist(f.a, f.b) },
        { key: 'angle', label: 'angle', value: deg(Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x)), deg: true },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Applying an edit
// ---------------------------------------------------------------------------

function setPath(obj: Record<string, unknown>, path: string, v: number): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys[keys.length - 1]] = v;
}

/** A stable construction anchor for whole-shape positional constraints. */
export function shapeAnchor(s: Shape): Pt {
  switch (s.kind) {
    case 'circle':
    case 'ellipse':
    case 'polygon':
      return { ...s.c };
    case 'rect':
      return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    case 'line':
      return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    case 'text':
      return { ...s.p };
    case 'path': {
      const pts = s.contours.flatMap((c) => c.segs.flatMap((f) => [segStart(f), segEnd(f)].filter((p): p is Pt => p != null)));
      if (!pts.length) return { x: 0, y: 0 };
      return {
        x: (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2,
        y: (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2,
      };
    }
  }
}

/** Translate a recovered primitive without changing its intrinsic geometry. */
export function translateShape(s: Shape, dx: number, dy: number): void {
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return;
  const p = (q: Pt): Pt => ({ x: q.x + dx, y: q.y + dy });
  switch (s.kind) {
    case 'circle':
    case 'ellipse':
      s.c = p(s.c);
      break;
    case 'polygon':
      s.c = p(s.c);
      s.pts = s.pts.map(p);
      break;
    case 'rect':
      s.x += dx;
      s.y += dy;
      break;
    case 'line':
      s.a = p(s.a);
      s.b = p(s.b);
      break;
    case 'text':
      s.p = p(s.p);
      break;
    case 'path':
      for (const c of s.contours) for (const f of c.segs) {
        if (f.kind === 'line') f.a = p(f.a), f.b = p(f.b);
        else if (f.kind === 'arc') f.c = p(f.c), f.a = p(f.a), f.b = p(f.b);
        else if (f.kind === 'circle' || f.kind === 'ellipse') f.c = p(f.c);
        else f.pts = f.pts.map(p);
      }
      break;
  }
  translateCutouts(s.cutouts, dx, dy);
}

function translateCutout(s: Cutout, dx: number, dy: number): void {
  const p = (q: Pt): Pt => ({ x: q.x + dx, y: q.y + dy });
  switch (s.kind) {
    case 'circle':
    case 'ellipse':
      s.c = p(s.c);
      break;
    case 'rect':
      s.x += dx;
      s.y += dy;
      break;
    case 'polygon':
      s.pts = s.pts.map(p);
      break;
    case 'path':
      for (const c of s.contours) for (const f of c.segs) {
        if (f.kind === 'line') f.a = p(f.a), f.b = p(f.b);
        else if (f.kind === 'arc') f.c = p(f.c), f.a = p(f.a), f.b = p(f.b);
        else if (f.kind === 'circle' || f.kind === 'ellipse') f.c = p(f.c);
        else f.pts = f.pts.map(p);
      }
      break;
  }
}

function translateCutouts(cutouts: Cutout[] | undefined, dx: number, dy: number): void {
  if (!cutouts || (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12)) return;
  for (const c of cutouts) translateCutout(c, dx, dy);
}

/** Regenerate a polygon's vertices after its centre, radius, count or rotation changed. */
export function refreshPolygon(s: Shape): void {
  if (s.kind !== 'polygon') return;
  const n = Math.max(3, Math.round(s.sides));
  s.sides = n;
  s.pts = Array.from({ length: n }, (_, i) => {
    const a = s.rot + (2 * Math.PI * i) / n;
    return { x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) };
  });
}

/** An edited value is the user's intent, not a measurement of the source. */
function markEdited(s: Shape): void {
  s.meta.confidence = 1;
  s.meta.maxDev = 0;
}

/**
 * Edit one shape parameter and propagate it through the detected constraints.
 * This is the payoff of recovering constraints at all: changing one radius
 * moves every shape found to share it.
 */
export function editShapeParam(scene: Scene, id: string, path: string, value: number, opts: EditOptions = {}): ShapeEditResult {
  return editShapeParams(scene, id, { [path]: value }, opts);
}

/**
 * Apply related whole-shape values atomically. Pointer drags use this for x/y,
 * so a constrained centre is solved once instead of visiting a half-edited
 * state between its two coordinates.
 */
export function editShapeParams(
  scene: Scene,
  id: string,
  values: Record<string, number>,
  opts: EditOptions = {},
): ShapeEditResult {
  const target = scene.shapes.find((s) => s.id === id);
  const out: ShapeEditResult = { applied: false, linked: [] };
  if (!target || Object.values(values).some((v) => !Number.isFinite(v))) return out;

  const before = new Map(scene.shapes.map((s) => [s.id, shapeAnchor(s)]));
  const targetOrigin = target.kind === 'rect' ? { x: target.x, y: target.y } : shapeAnchor(target);
  const fields = new Map(shapeFields(target).map((f) => [f.key, f]));
  // Validate the whole batch before writing anything: a bad key or value must
  // refuse the edit atomically, not leave the shape half-mutated.
  const actual = new Map<string, number>();
  for (const [path, value] of Object.entries(values)) {
    const field = fields.get(path);
    if (!field) return out;
    const v = field.deg ? rad(value) : value;
    if ((path === 'r' || path === 'rx' || path === 'ry' || path === 'w' || path === 'h') && !(v >= 0)) return out;
    actual.set(path, v);
  }
  for (const [path, v] of actual) setPath(target as unknown as Record<string, unknown>, path, v);
  refreshPolygon(target);
  // Positional fields move attached cutouts with their parent. Size and
  // rotation edits leave the cut geometry in place, which keeps subtraction
  // non-destructive rather than silently scaling the cutter.
  const oldAnchor = before.get(id)!;
  const newAnchor = shapeAnchor(target);
  const moveX = actual.has('c.x') || (target.kind === 'rect' && actual.has('x'));
  const moveY = actual.has('c.y') || (target.kind === 'rect' && actual.has('y'));
  const dx = target.kind === 'rect' ? target.x - targetOrigin.x : newAnchor.x - oldAnchor.x;
  const dy = target.kind === 'rect' ? target.y - targetOrigin.y : newAnchor.y - oldAnchor.y;
  translateCutouts(target.cutouts, moveX ? dx : 0, moveY ? dy : 0);
  markEdited(target);
  out.applied = true;
  if (!opts.enforce) return out;

  const linked = new Set<string>();
  const touch = (s: Shape): void => {
    if (s.id !== id) linked.add(s.id);
    markEdited(s);
  };

  // Scalar construction constraints preserve only the relevant degree of
  // freedom. Horizontal alignment does not lock x; equal radius does not lock
  // the centre.
  for (const c of scene.constraints) {
    if (!('ids' in c) || !c.ids.includes(id)) continue;
    if (c.kind === 'equal-radius' && (actual.has('r') || actual.has('rx'))) {
      const v = actual.get('r') ?? actual.get('rx')!;
      for (const other of scene.shapes) {
        if (other.id === id || !c.ids.includes(other.id)) continue;
        if (other.kind === 'circle' || other.kind === 'polygon') {
          other.r = v;
          refreshPolygon(other);
          touch(other);
        }
      }
      c.value = v;
    }
    if ((c.kind === 'concentric' || c.kind === 'concentric-with') && (actual.has('c.x') || actual.has('c.y'))) {
      const at = shapeAnchor(target);
      for (const other of scene.shapes) {
        if (other.id === id || !c.ids.includes(other.id)) continue;
        const old = shapeAnchor(other);
        translateShape(other, actual.has('c.x') ? at.x - old.x : 0, actual.has('c.y') ? at.y - old.y : 0);
        touch(other);
      }
      if (actual.has('c.x')) c.c.x = at.x;
      if (actual.has('c.y')) c.c.y = at.y;
    }
    if (c.kind === 'aligned-h' && actual.has('c.y')) {
      const y = shapeAnchor(target).y;
      for (const other of scene.shapes) if (other.id !== id && c.ids.includes(other.id)) {
        const at = shapeAnchor(other);
        translateShape(other, 0, y - at.y);
        touch(other);
      }
      c.y = y;
    }
    if (c.kind === 'aligned-v' && actual.has('c.x')) {
      const x = shapeAnchor(target).x;
      for (const other of scene.shapes) if (other.id !== id && c.ids.includes(other.id)) {
        const at = shapeAnchor(other);
        translateShape(other, x - at.x, 0);
        touch(other);
      }
      c.x = x;
    }
  }

  // Preserve global mirror relationships by moving the matching counterpart.
  // A shape sitting on the mirror axis translates the whole construction and
  // the guide itself when dragged across that axis, instead of becoming stuck.
  for (const c of scene.constraints) {
    if (c.kind !== 'reflection' || !c.ids.includes(id) || (!actual.has('c.x') && !actual.has('c.y'))) continue;
    const vertical = Math.abs(c.axis.dir.x) < Math.abs(c.axis.dir.y);
    const old = before.get(id)!;
    const now = shapeAnchor(target);
    const axis = vertical ? c.axis.p.x : c.axis.p.y;
    const oldNormal = vertical ? old.x : old.y;
    const normalChanged = vertical ? actual.has('c.x') : actual.has('c.y');
    if (normalChanged && Math.abs(oldNormal - axis) <= Math.max(scene.report.tol * 4, 1e-6)) {
      const delta = (vertical ? now.x : now.y) - oldNormal;
      for (const other of scene.shapes) if (other.id !== id && c.ids.includes(other.id)) {
        translateShape(other, vertical ? delta : 0, vertical ? 0 : delta);
        touch(other);
      }
      if (vertical) c.axis.p.x += delta;
      else c.axis.p.y += delta;
      continue;
    }
    const mirroredOld = vertical ? { x: 2 * axis - old.x, y: old.y } : { x: old.x, y: 2 * axis - old.y };
    let partner: Shape | undefined;
    let best = Infinity;
    for (const other of scene.shapes) {
      if (other.id === id || !c.ids.includes(other.id)) continue;
      const p = before.get(other.id)!;
      const d = dist(p, mirroredOld);
      if (d < best) best = d, partner = other;
    }
    if (partner && best <= Math.max(scene.report.tol * 8, 1e-5)) {
      const want = vertical ? { x: 2 * axis - now.x, y: now.y } : { x: now.x, y: 2 * axis - now.y };
      const at = shapeAnchor(partner);
      translateShape(partner, want.x - at.x, want.y - at.y);
      touch(partner);
    }
  }

  // Rotational orbits behave like mirror pairs: dragging one member moves the
  // rest by the corresponding rotated delta. A centre member translates the
  // whole construction and its rotation guide.
  for (const c of scene.constraints) {
    if (c.kind !== 'rotational' || !c.ids.includes(id) || (!actual.has('c.x') && !actual.has('c.y'))) continue;
    const old = before.get(id)!;
    const now = shapeAnchor(target);
    const vx = old.x - c.c.x;
    const vy = old.y - c.c.y;
    if (Math.hypot(vx, vy) <= Math.max(scene.report.tol * 4, 1e-6)) {
      const dx = now.x - old.x;
      const dy = now.y - old.y;
      for (const other of scene.shapes) if (other.id !== id && c.ids.includes(other.id)) {
        translateShape(other, dx, dy);
        touch(other);
      }
      c.c.x += dx;
      c.c.y += dy;
      continue;
    }
    const used = new Set<string>([id]);
    for (let k = 1; k < c.order; k++) {
      const a = (2 * Math.PI * k) / c.order;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const expected = { x: c.c.x + cos * vx - sin * vy, y: c.c.y + sin * vx + cos * vy };
      let partner: Shape | undefined;
      let best = Infinity;
      for (const other of scene.shapes) {
        if (used.has(other.id) || !c.ids.includes(other.id)) continue;
        const d = dist(before.get(other.id)!, expected);
        if (d < best) best = d, partner = other;
      }
      if (!partner || best > Math.max(scene.report.tol * 8, 1e-5)) continue;
      used.add(partner.id);
      const nx = now.x - c.c.x;
      const ny = now.y - c.c.y;
      const want = { x: c.c.x + cos * nx - sin * ny, y: c.c.y + sin * nx + cos * ny };
      const at = shapeAnchor(partner);
      translateShape(partner, want.x - at.x, want.y - at.y);
      touch(partner);
    }
  }

  out.linked = [...linked];
  return out;
}

/** Apply one value to a segment's own parameters. Neighbours are not touched. */
function applyToSeg(f: Fit, key: string, value: number): boolean {
  if (f.kind === 'arc') {
    switch (key) {
      case 'r':
        if (!(value > 0)) return false;
        f.r = value;
        break;
      case 'cx':
        f.c = { x: value, y: f.c.y };
        break;
      case 'cy':
        f.c = { x: f.c.x, y: value };
        break;
      case 'sweep': {
        const s = rad(value);
        if (Math.abs(s) < 1e-9 || Math.abs(s) > 2 * Math.PI) return false;
        f.a1 = f.a0 + s;
        break;
      }
      default:
        return false;
    }
    syncArcEnds(f);
    return true;
  }
  if (f.kind === 'line') {
    const d = norm(sub(f.b, f.a));
    const l = len(sub(f.b, f.a));
    switch (key) {
      case 'x1':
        f.a = { x: value, y: f.a.y };
        break;
      case 'y1':
        f.a = { x: f.a.x, y: value };
        break;
      case 'x2':
        f.b = { x: value, y: f.b.y };
        break;
      case 'y2':
        f.b = { x: f.b.x, y: value };
        break;
      case 'len':
        if (!(value > 0)) return false;
        f.b = { x: f.a.x + d.x * value, y: f.a.y + d.y * value };
        break;
      case 'angle': {
        const a = rad(value);
        f.b = { x: f.a.x + Math.cos(a) * l, y: f.a.y + Math.sin(a) * l };
        break;
      }
      default:
        return false;
    }
    return true;
  }
  return false;
}

interface Target {
  shape: Shape;
  contour: Contour;
  ref: SegRef;
}

function locate(scene: Scene, ref: SegRef): Target | null {
  const shape = scene.shapes.find((s) => s.id === ref.shape);
  if (!shape || shape.kind !== 'path') return null;
  const contour = shape.contours[ref.contour];
  if (!contour || !contour.segs[ref.seg]) return null;
  return { shape, contour, ref };
}

export interface SegEditResult {
  /** Leftover gap at the join furthest from the edit, per contour touched. */
  residual: number;
  /** Segments that moved along with the edited one, via a shared constraint. */
  linked: SegRef[];
  /** False when the edit was rolled back for exceeding `maxResidual`. */
  applied: boolean;
  /**
   * True when the solve pulled the value back: the join either side determines
   * it, so it is not a free parameter of this segment. An arc between two
   * tangent lines has its sweep fixed by them, for one.
   */
  constrained?: boolean;
}

/**
 * Edit one segment's construction value — an arc's radius, a line's length —
 * and reconnect the contour around it.
 *
 * With `enforce`, an `equal-radius-seg` group moves as one: a radius that the
 * artwork repeated stays repeated, which is the whole reason the group was
 * detected. Every contour touched is re-solved from the segment that changed.
 */
export function editSegmentParam(
  scene: Scene,
  ref: SegRef,
  key: string,
  value: number,
  opts: EditOptions = {},
): SegEditResult {
  const g1Tol = opts.g1Tol ?? DEFAULTS.g1Tol;
  const out: SegEditResult = { residual: 0, linked: [], applied: true };
  const target = locate(scene, ref);
  if (!target || !Number.isFinite(value)) {
    out.applied = false;
    return out;
  }

  const group: SegRef[] = [ref];
  const radiusGroups: Extract<Constraint, { kind: 'equal-radius-seg' }>[] = [];
  if (opts.enforce && key === 'r') {
    for (const c of scene.constraints) {
      if (c.kind !== 'equal-radius-seg') continue;
      if (!c.segs.some((s) => sameRef(s, ref))) continue;
      radiusGroups.push(c);
      for (const s of c.segs) if (!group.some((g) => sameRef(g, s))) group.push(s);
    }
  }

  // Joins are classified from the geometry, so they must be read before any
  // segment moves — a broken join reads as a corner.
  const jobs: { contour: Contour; joins: JoinSpec[]; fixed: number | null; undo: Fit[]; gap0: number }[] = [];
  for (const r of group) {
    const t = locate(scene, r);
    if (!t) continue;
    let job = jobs.find((j) => j.contour === t.contour);
    if (!job) {
      job = {
        contour: t.contour,
        joins: captureJoins(t.contour, g1Tol),
        fixed: null,
        undo: t.contour.segs.map(cloneFit),
        // Fitted segments are fitted independently, so a freshly reconstructed
        // contour already has joins a fraction of a tolerance apart. Tearing is
        // measured against that, not against zero.
        gap0: maxGap(t.contour),
      };
      jobs.push(job);
    }
    if (!applyToSeg(t.contour.segs[r.seg], key, value)) {
      out.applied = false;
      break;
    }
    // A radius change is a fillet: hold the tangent straight neighbours still
    // and move the centre, rather than swinging the neighbours to follow.
    if (key === 'r') refitArcRadius(t.contour, r.seg, job.joins);
    if (!sameRef(r, ref)) out.linked.push(r);
    // Each contour is solved outwards from a segment that changed in it, and
    // from the one the user actually edited when that is this contour.
    if (job.fixed == null || sameRef(r, ref)) job.fixed = r.seg;
  }

  let rejected = !out.applied;
  for (const job of jobs) {
    if (job.fixed == null) continue;
    const res = solveContour(job.contour, job.joins, job.fixed);
    if (job.contour === target.contour) out.residual = res;
    if (opts.maxResidual != null && res > opts.maxResidual + job.gap0) {
      rejected = true;
    }
  }

  if (rejected) {
    for (const job of jobs) job.contour.segs = job.undo;
    out.applied = false;
    out.linked = [];
    return out;
  }

  for (const r of group) {
    const t = locate(scene, r);
    if (t) markEdited(t.shape);
  }
  for (const c of radiusGroups) c.value = value;

  if (out.applied) {
    const now = segmentFields(target.contour.segs[ref.seg]).find((f) => f.key === key);
    if (now && Math.abs(now.value - value) > Math.max(1e-6, Math.abs(value) * 1e-6)) out.constrained = true;
  }
  return out;
}

const cloneFit = (f: Fit): Fit =>
  f.kind === 'cubic'
    ? { ...f, pts: f.pts.map((p) => ({ ...p })), c1: f.c1 && { ...f.c1 }, c2: f.c2 && { ...f.c2 } }
    : { ...f };

/**
 * Where the fillet refit would put an arc's centre at radius `r`, probed on a
 * throwaway copy of the contour so nothing real moves.
 */
function probeArcCentre(contour: Contour, seg: number, joins: JoinSpec[], r: number): Pt {
  const copy: Contour = { ...contour, segs: contour.segs.map(cloneFit) };
  const f = copy.segs[seg] as Extract<Fit, { kind: 'arc' }>;
  f.r = r;
  syncArcEnds(f);
  refitArcRadius(copy, seg, joins.map((j) => ({ ...j, at: { ...j.at } })));
  return (copy.segs[seg] as Extract<Fit, { kind: 'arc' }>).c;
}

/**
 * Set an arc's radius from a dragged point: solve for the radius whose refitted
 * arc passes through `p`, then apply it through `editSegmentParam`.
 *
 * The naive drag rule — radius = distance from pointer to the current centre —
 * diverges on a fillet: growing the radius moves the centre away along the
 * corner bisector faster than the radius grows, so each pointer event amplifies
 * the last and the arc runs away. The refit places the centre affinely in r,
 * c(r) = c0 + r·v, so "the arc passes through p" is one quadratic in r:
 * |p − c0 − r·v|² = r². Solving it lands the arc under the cursor and makes the
 * drag a stable fixed point instead of a feedback loop.
 */
export function editSegmentRadiusAt(scene: Scene, ref: SegRef, p: Pt, opts: EditOptions = {}): SegEditResult {
  const t = locate(scene, ref);
  const fail: SegEditResult = { residual: 0, linked: [], applied: false };
  if (!t || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return fail;
  const f = t.contour.segs[ref.seg];
  if (f.kind !== 'arc') return fail;

  const joins = captureJoins(t.contour, opts.g1Tol ?? DEFAULTS.g1Tol);
  const r0 = f.r;
  const r1 = r0 * 1.5 + 1;
  const cAt0 = probeArcCentre(t.contour, ref.seg, joins, r0);
  const cAt1 = probeArcCentre(t.contour, ref.seg, joins, r1);
  const v = { x: (cAt1.x - cAt0.x) / (r1 - r0), y: (cAt1.y - cAt0.y) / (r1 - r0) };
  const c0 = { x: cAt0.x - r0 * v.x, y: cAt0.y - r0 * v.y };

  // |w − r·v|² = r²  →  (|v|²−1)·r² − 2(w·v)·r + |w|² = 0
  const w = sub(p, c0);
  const a = dot(v, v) - 1;
  const b = dot(w, v);
  const c = dot(w, w);
  let r: number;
  if (Math.abs(a) < 1e-9) {
    // Fixed centre (|v| = 0 gives a = −1, handled below); |v| = 1 degenerates
    // to the linear case.
    r = Math.abs(b) > 1e-12 ? c / (2 * b) : r0;
  } else {
    const disc = b * b - a * c;
    if (disc < 0) {
      // No radius reaches the pointer; take the closest approach.
      r = b / a;
    } else {
      const sq = Math.sqrt(disc);
      const roots = [(b + sq) / a, (b - sq) / a].filter((x) => x > 0 && Number.isFinite(x));
      // Both roots put the arc through p; stay on the branch the drag is on.
      r = roots.length ? roots.reduce((best, x) => (Math.abs(x - r0) < Math.abs(best - r0) ? x : best)) : r0;
    }
  }
  if (!(r > 0) || !Number.isFinite(r)) return fail;
  return editSegmentParam(scene, ref, 'r', r, opts);
}

const sameRef = (a: SegRef, b: SegRef): boolean => a.shape === b.shape && a.contour === b.contour && a.seg === b.seg;

/** Move a join — the point two segments share — to `x, y`. */
export function moveJoin(scene: Scene, ref: SegRef, end: 'start' | 'end', x: number, y: number, opts: EditOptions = {}): SegEditResult {
  const t = locate(scene, ref);
  const out: SegEditResult = { residual: 0, linked: [], applied: true };
  if (!t) {
    out.applied = false;
    return out;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    out.applied = false;
    return out;
  }
  const f = t.contour.segs[ref.seg];
  const joins = captureJoins(t.contour, opts.g1Tol ?? DEFAULTS.g1Tol);
  const undo = t.contour.segs.map(cloneFit);
  const gap0 = maxGap(t.contour);
  if (f.kind === 'line') {
    if (end === 'start') f.a = { x, y };
    else f.b = { x, y };
  }
  if (f.kind === 'arc') {
    // An arc end is not a free parameter: keep the radius and slide the centre,
    // which is what dragging the end of an arc means on a construction drawing.
    const cur = end === 'start' ? segStart(f) : segEnd(f);
    if (cur) {
      f.c = { x: f.c.x + (x - cur.x), y: f.c.y + (y - cur.y) };
      syncArcEnds(f);
    }
  }
  if (f.kind === 'cubic') {
    placeCubicEnd(f, end, { x, y });
  }
  if (f.kind !== 'line' && f.kind !== 'arc' && f.kind !== 'cubic') {
    out.applied = false;
    return out;
  }
  out.residual = solveContour(t.contour, joins, ref.seg);
  if (opts.maxResidual != null && out.residual > opts.maxResidual + gap0) {
    t.contour.segs = undo;
    out.applied = false;
    return out;
  }
  markEdited(t.shape);
  return out;
}

/**
 * Move one control point of an authored bezier. Control points steer tangents
 * only — the endpoints stay put — so the neighbours never need re-solving.
 */
export function editCubicControl(scene: Scene, ref: SegRef, which: 'c1' | 'c2', p: Pt, opts: EditOptions = {}): SegEditResult {
  void opts;
  const t = locate(scene, ref);
  const out: SegEditResult = { residual: 0, linked: [], applied: true };
  const f = t?.contour.segs[ref.seg];
  if (!t || !f || !isBezier(f) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    out.applied = false;
    return out;
  }
  f[which] = { x: p.x, y: p.y };
  syncCubic(f);
  markEdited(t.shape);
  return out;
}

/** Move an arc centre atomically, preserving the joins or refusing the edit. */
export function moveSegmentCenter(
  scene: Scene,
  ref: SegRef,
  x: number,
  y: number,
  opts: EditOptions = {},
): SegEditResult {
  const t = locate(scene, ref);
  const out: SegEditResult = { residual: 0, linked: [], applied: true };
  if (!t || !Number.isFinite(x) || !Number.isFinite(y) || t.contour.segs[ref.seg].kind !== 'arc') {
    out.applied = false;
    return out;
  }
  const joins = captureJoins(t.contour, opts.g1Tol ?? DEFAULTS.g1Tol);
  const undo = t.contour.segs.map(cloneFit);
  const gap0 = maxGap(t.contour);
  const f = t.contour.segs[ref.seg] as Extract<Fit, { kind: 'arc' }>;
  f.c = { x, y };
  syncArcEnds(f);
  out.residual = solveContour(t.contour, joins, ref.seg);
  if (opts.maxResidual != null && out.residual > opts.maxResidual + gap0) {
    t.contour.segs = undo;
    out.applied = false;
    return out;
  }
  markEdited(t.shape);
  return out;
}

// ---------------------------------------------------------------------------
// Keeping the construction listing in step with the edits
// ---------------------------------------------------------------------------

const SEG_LEVEL: ReadonlySet<Constraint['kind']> = new Set([
  'tangent',
  'corner',
  'semicircle',
  'equal-radius-seg',
  'aspect',
] as Constraint['kind'][]);

/**
 * Re-derive the per-segment construction after an edit, so the table reads back
 * what the geometry now is.
 *
 * The ink bbox is carried over rather than recomputed: it is measured from the
 * source regions, stroke expansion included, and those are gone by this point.
 * Aspect and the tight-viewBox flag are therefore as of the last reconstruct.
 */
export function rebuildConstruction(scene: Scene, opts: EditOptions & Options = {}): void {
  const tol = opts.tol ?? scene.report.tol;
  const g1Tol = opts.g1Tol ?? DEFAULTS.g1Tol;
  const ink = scene.construction?.ink ?? {
    x0: scene.viewBox[0],
    y0: scene.viewBox[1],
    x1: scene.viewBox[0] + scene.viewBox[2],
    y1: scene.viewBox[1] + scene.viewBox[3],
  };
  const res = analyzeConstruction(scene.shapes, ink, scene.viewBox, tol, g1Tol);
  scene.construction = res.construction;
  scene.constraints = scene.constraints.filter((c) => !SEG_LEVEL.has(c.kind)).concat(res.constraints);
}
