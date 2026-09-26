import type { Pt, Scene, SegRef, Shape } from '../../../src/types.ts';
import {
  editCubicControl,
  editSegmentRadiusAt,
  editShapeParam,
  editShapeParams,
  isBezier,
  moveJoin,
  moveSegmentCenter,
  segEnd,
  segStart,
  type EditOptions,
} from '../../../src/index.ts';

export interface Handle {
  at: Pt;
  hint: string;
  /** Radius handles draw hollow — they set a length, not a position. */
  radius?: boolean;
  shape: string;
  seg?: SegRef;
  apply: (p: Pt) => void;
}

type Track = (res: { applied: boolean; residual?: number; constrained?: boolean }) => void;

/** Handles for a shape's own parameters — the ones the panel also lists. */
export function shapeHandles(scene: Scene, s: Shape, opts: EditOptions, track: Track): Handle[] {
  const out: Handle[] = [];
  const set = (key: string) => (v: number) => {
    editShapeParam(scene, s.id, key, v, opts);
  };
  const pointH = (at: Pt, hint: string, kx: string, ky: string): Handle => ({
    at,
    hint,
    shape: s.id,
    apply: (p) => {
      editShapeParams(scene, s.id, { [kx]: p.x, [ky]: p.y }, opts);
    },
  });
  switch (s.kind) {
    case 'circle':
      out.push(pointH(s.c, 'centre', 'c.x', 'c.y'));
      out.push({
        at: { x: s.c.x + s.r, y: s.c.y },
        hint: 'r',
        radius: true,
        shape: s.id,
        apply: (p) => set('r')(Math.hypot(p.x - s.c.x, p.y - s.c.y)),
      });
      break;
    case 'ellipse':
      out.push(pointH(s.c, 'centre', 'c.x', 'c.y'));
      out.push({ at: { x: s.c.x + s.rx, y: s.c.y }, hint: 'rx', radius: true, shape: s.id, apply: (p) => set('rx')(Math.abs(p.x - s.c.x)) });
      out.push({ at: { x: s.c.x, y: s.c.y + s.ry }, hint: 'ry', radius: true, shape: s.id, apply: (p) => set('ry')(Math.abs(p.y - s.c.y)) });
      break;
    case 'rect':
      out.push(pointH({ x: s.x, y: s.y }, 'origin', 'x', 'y'));
      out.push({
        at: { x: s.x + s.w, y: s.y + s.h },
        hint: 'size',
        shape: s.id,
        apply: (p) => {
          editShapeParams(scene, s.id, { w: Math.max(0, p.x - s.x), h: Math.max(0, p.y - s.y) }, opts);
        },
      });
      if (s.rx > 0)
        out.push({ at: { x: s.x + s.rx, y: s.y }, hint: 'corner r', radius: true, shape: s.id, apply: (p) => set('rx')(Math.max(0, p.x - s.x)) });
      break;
    case 'line':
      out.push(pointH(s.a, 'x1 y1', 'a.x', 'a.y'), pointH(s.b, 'x2 y2', 'b.x', 'b.y'));
      break;
    case 'polygon':
      out.push(pointH(s.c, 'centre', 'c.x', 'c.y'));
      out.push({
        at: s.pts[0] ?? s.c,
        hint: 'r',
        radius: true,
        shape: s.id,
        apply: (p) => set('r')(Math.hypot(p.x - s.c.x, p.y - s.c.y)),
      });
      break;
    case 'text':
      out.push(pointH(s.p, 'anchor', 'p.x', 'p.y'));
      break;
    case 'path':
      out.push(...pathHandles(scene, s, opts, track));
      break;
  }
  return out;
}

/**
 * A path is dragged by its construction, not by its coordinates: an arc by its
 * centre and radius, a join by the point two segments share. Both go through
 * the solver, so the neighbours follow and tangency survives.
 */
function pathHandles(scene: Scene, s: Extract<Shape, { kind: 'path' }>, opts: EditOptions, track: Track): Handle[] {
  const out: Handle[] = [];
  s.contours.forEach((c, ci) => {
    c.segs.forEach((f, i) => {
      const ref: SegRef = { shape: s.id, contour: ci, seg: i };
      const start = segStart(f);
      if (start) {
        out.push({
          at: start,
          hint: `join ${i}`,
          shape: s.id,
          seg: ref,
          apply: (p) => track(moveJoin(scene, ref, 'start', p.x, p.y, opts)),
        });
      }
      if (isBezier(f)) {
        // Control points draw hollow, like radius handles: they set a tangent,
        // not a point on the outline.
        out.push({ at: f.c1, hint: `c1 ${i}`, radius: true, shape: s.id, seg: ref, apply: (p) => track(editCubicControl(scene, ref, 'c1', p, opts)) });
        out.push({ at: f.c2, hint: `c2 ${i}`, radius: true, shape: s.id, seg: ref, apply: (p) => track(editCubicControl(scene, ref, 'c2', p, opts)) });
      }
      if (f.kind !== 'arc') return;
      out.push({
        at: f.c,
        hint: `centre ${i}`,
        shape: s.id,
        seg: ref,
        apply: (p) => track(moveSegmentCenter(scene, ref, p.x, p.y, opts)),
      });
      const mid = (f.a0 + f.a1) / 2;
      out.push({
        at: { x: f.c.x + f.r * Math.cos(mid), y: f.c.y + f.r * Math.sin(mid) },
        hint: `r ${i}`,
        radius: true,
        shape: s.id,
        seg: ref,
        // Solved, not measured: radius-from-centre distance diverges when the
        // refit moves the centre, so the engine solves the radius that puts
        // the arc under the pointer.
        apply: (p) => track(editSegmentRadiusAt(scene, ref, p, opts)),
      });
    });
    const last = c.segs[c.segs.length - 1];
    if (!c.closed && last) {
      const end = segEnd(last);
      const ref: SegRef = { shape: s.id, contour: ci, seg: c.segs.length - 1 };
      if (end) out.push({ at: end, hint: 'end', shape: s.id, seg: ref, apply: (p) => track(moveJoin(scene, ref, 'end', p.x, p.y, opts)) });
    }
  });
  return out;
}
