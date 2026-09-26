import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reconstructSVG } from '../src/reconstruct.ts';
import { flattenSVG } from '../src/bench/flatten.ts';
import { sceneToSVG } from '../src/emit/to-svg.ts';
import { createShape } from '../src/edit/create.ts';
import {
  editCubicControl,
  editSegmentParam,
  editSegmentRadiusAt,
  editShapeParam,
  editShapeParams,
  moveJoin,
  moveSegmentCenter,
  rebuildConstruction,
  segmentFields,
  shapeFields,
} from '../src/edit/index.ts';
import { segEnd, segStart, segTangent } from '../src/geom/seg.ts';
import type { ArcFit, Contour, LineFit, Scene, Shape } from '../src/types.ts';

const fixture = (name: string): Scene => reconstructSVG(flattenSVG(readFileSync(`fixtures/${name}.svg`, 'utf8')));

const pathShape = (scene: Scene): Extract<Shape, { kind: 'path' }> => {
  const s = scene.shapes.find((x) => x.kind === 'path');
  if (!s || s.kind !== 'path') throw new Error('no path shape');
  return s;
};

/** Widest gap between segments that are supposed to share a point. */
function maxGap(c: Contour): number {
  let worst = 0;
  for (let i = 0; i < c.segs.length; i++) {
    const j = i + 1 < c.segs.length ? i + 1 : c.closed ? 0 : -1;
    if (j < 0) continue;
    const a = segEnd(c.segs[i]);
    const b = segStart(c.segs[j]);
    if (!a || !b) continue;
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return worst;
}

/** Widest turn at a join that was tangent before the edit. */
function maxKink(c: Contour, tangent: boolean[]): number {
  let worst = 0;
  for (let i = 0; i < c.segs.length; i++) {
    const j = i + 1 < c.segs.length ? i + 1 : c.closed ? 0 : -1;
    if (j < 0 || !tangent[i]) continue;
    const a = segTangent(c.segs[i], 'end');
    const b = segTangent(c.segs[j], 'start');
    if (!a || !b) continue;
    worst = Math.max(worst, Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)));
  }
  return worst;
}

const tangentMap = (c: Contour, g1 = 0.02): boolean[] =>
  c.segs.map((_, i) => {
    const j = i + 1 < c.segs.length ? i + 1 : c.closed ? 0 : -1;
    if (j < 0) return false;
    const a = segTangent(c.segs[i], 'end');
    const b = segTangent(c.segs[j], 'start');
    if (!a || !b) return false;
    return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) <= g1;
  });

describe('segment editing', () => {
  it('offers the construction values of a segment, not its coordinates', () => {
    const scene = fixture('21-tangent-skeleton');
    const c = pathShape(scene).contours[0];
    const arc = c.segs.find((f) => f.kind === 'arc')!;
    expect(segmentFields(arc).map((f) => f.key)).toEqual(['r', 'cx', 'cy', 'sweep']);
    const line = c.segs.find((f) => f.kind === 'line')!;
    expect(segmentFields(line).map((f) => f.key)).toContain('len');
  });

  it('keeps the chain joined and tangent when an arc radius changes', () => {
    const scene = fixture('21-tangent-skeleton');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const tangent = tangentMap(c);
    const idx = c.segs.findIndex((f) => f.kind === 'arc');

    const res = editSegmentParam(scene, { shape: shape.id, contour: 0, seg: idx }, 'r', 30);

    expect(res.applied).toBe(true);
    expect((c.segs[idx] as ArcFit).r).toBeCloseTo(30, 9);
    expect(maxGap(c)).toBeLessThan(1e-9);
    expect(maxKink(c, tangent)).toBeLessThan(1e-6);
  });

  it('drags a fillet radius stably: the arc lands under the pointer and stays there', () => {
    const scene = fixture('21-tangent-skeleton');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const tangent = tangentMap(c);
    const idx = c.segs.findIndex((f) => f.kind === 'arc');
    const ref = { shape: shape.id, contour: 0, seg: idx };
    const f0 = c.segs[idx] as ArcFit;
    const r0 = f0.r;
    // Grab the mid-arc radius handle, nudge it 3 units outward, hold still.
    const mid = (f0.a0 + f0.a1) / 2;
    const p = { x: f0.c.x + (r0 + 3) * Math.cos(mid), y: f0.c.y + (r0 + 3) * Math.sin(mid) };

    // The naive rule (r = pointer-to-centre distance) diverges here, because a
    // fillet refit moves the centre away faster than the radius grows. The
    // solved drag must instead converge: repeated events with a still pointer
    // change nothing after the first.
    const radii: number[] = [];
    for (let ev = 0; ev < 8; ev++) {
      const res = editSegmentRadiusAt(scene, ref, p, {});
      expect(res.applied).toBe(true);
      radii.push((c.segs[idx] as ArcFit).r);
    }
    expect(radii[7]).toBeCloseTo(radii[0], 9);
    // The arc actually passes through the pointer...
    const g = c.segs[idx] as ArcFit;
    expect(Math.abs(Math.hypot(p.x - g.c.x, p.y - g.c.y) - g.r)).toBeLessThan(1e-9);
    // ...and the chain is still joined and tangent.
    expect(maxGap(c)).toBeLessThan(1e-9);
    expect(maxKink(c, tangent)).toBeLessThan(1e-6);
  });

  it('holds tangent straight neighbours still: a fillet moves the arc, not the stem', () => {
    const scene = fixture('21-tangent-skeleton');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const idx = c.segs.findIndex((f) => f.kind === 'arc');
    const stem = c.segs[idx - 1] as LineFit;
    const dir = (l: LineFit): number => Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
    const before = { x: stem.a.x, y: stem.a.y, dir: dir(stem) };

    editSegmentParam(scene, { shape: shape.id, contour: 0, seg: idx }, 'r', 30);

    // The stem keeps its far end and its direction; only its length is trimmed.
    expect(stem.a.x).toBeCloseTo(before.x, 9);
    expect(stem.a.y).toBeCloseTo(before.y, 9);
    expect(dir(stem)).toBeCloseTo(before.dir, 9);
  });

  it('leaves a corner a corner', () => {
    const scene = fixture('19-arc-lines-mixed');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const tangent = tangentMap(c);
    const corners = c.segs.map((_, i) => !tangent[i]);
    const idx = c.segs.findIndex((f) => f.kind === 'arc');
    if (idx < 0) return;
    const angleAt = (i: number): number => {
      const j = i + 1 < c.segs.length ? i + 1 : 0;
      const a = segTangent(c.segs[i], 'end')!;
      const b = segTangent(c.segs[j], 'start')!;
      return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
    };
    const before = c.segs.map((_, i) => (corners[i] ? angleAt(i) : 0));

    editSegmentParam(scene, { shape: shape.id, contour: 0, seg: idx }, 'r', (c.segs[idx] as ArcFit).r * 1.2);

    for (let i = 0; i < c.segs.length; i++) {
      if (!corners[i]) continue;
      expect(Math.abs(angleAt(i) - before[i])).toBeLessThan(0.2);
    }
    expect(maxGap(c)).toBeLessThan(1e-6);
  });

  it('widens a rounded end by moving its parallel sides apart', () => {
    const scene = fixture('19-arc-lines-mixed');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const idx = c.segs.findIndex((f) => f.kind === 'arc');
    const sides = c.segs.filter((f): f is LineFit => f.kind === 'line').slice(0, 2);
    const dirs = sides.map((l) => Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x));
    const gapBefore = Math.abs(sides[0].a.x - sides[1].b.x);

    editSegmentParam(scene, { shape: shape.id, contour: 0, seg: idx }, 'r', 72);

    // Sides stay vertical, 2r apart — the arc's centre does not run off.
    sides.forEach((l, i) => expect(Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x)).toBeCloseTo(dirs[i], 6));
    expect(Math.abs(sides[0].a.x - sides[1].b.x)).toBeCloseTo(gapBefore + 24, 1);
    expect(maxGap(c)).toBeLessThan(1e-6);
  });

  it('moves a whole equal-radius group when constraints are enforced', () => {
    const scene = fixture('21-tangent-skeleton');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const group = scene.constraints.find((k) => k.kind === 'equal-radius-seg');
    if (!group || group.kind !== 'equal-radius-seg') return; // fixture has no group
    const ref = group.segs[0];
    editSegmentParam(scene, ref, 'r', 12, { enforce: true });
    for (const s of group.segs) expect((c.segs[s.seg] as ArcFit).r).toBeCloseTo(12, 9);
  });

  it('rolls back an edit that would tear a closed contour open', () => {
    const scene = fixture('13-freeform-blob');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const idx = c.segs.findIndex((f) => f.kind === 'arc');
    const before = (c.segs[idx] as ArcFit).r;
    const gapBefore = maxGap(c);

    const res = editSegmentParam(scene, { shape: shape.id, contour: 0, seg: idx }, 'r', before * 1.5, {
      maxResidual: scene.report.tol,
    });

    expect(res.applied).toBe(false);
    expect((c.segs[idx] as ArcFit).r).toBeCloseTo(before, 9);
    expect(maxGap(c)).toBeCloseTo(gapBefore, 9);
  });

  it('drags a join without breaking the segments either side', () => {
    const scene = fixture('21-tangent-skeleton');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const at = segEnd(c.segs[0])!;

    moveJoin(scene, { shape: shape.id, contour: 0, seg: 0 }, 'end', at.x + 3, at.y - 2);

    expect(segEnd(c.segs[0])!.x).toBeCloseTo(at.x + 3, 6);
    expect(maxGap(c)).toBeLessThan(1e-6);
  });

  it('re-derives the construction listing after an edit', () => {
    const scene = fixture('21-tangent-skeleton');
    const shape = pathShape(scene);
    const idx = shape.contours[0].segs.findIndex((f) => f.kind === 'arc');
    editSegmentParam(scene, { shape: shape.id, contour: 0, seg: idx }, 'r', 30);
    rebuildConstruction(scene);
    const note = scene.construction!.segs.find((n) => n.ref.seg === idx)!;
    expect(note.r).toBeCloseTo(30, 6);
    expect(note.value).toContain('30.000');
    expect(sceneToSVG(scene)).not.toMatch(/NaN/);
  });

  it('propagates a shape-level radius through equal-radius constraints', () => {
    const scene = fixture('14-logo-composite');
    const eq = scene.constraints.find((c) => c.kind === 'equal-radius');
    if (!eq || eq.kind !== 'equal-radius') throw new Error('fixture lost its equal-radius constraint');
    editShapeParam(scene, eq.ids[0], 'r', 40, { enforce: true });
    for (const id of eq.ids) {
      const s = scene.shapes.find((x) => x.id === id)!;
      if (s.kind === 'circle') expect(s.r).toBeCloseTo(40, 9);
    }
  });

  it('rolls an arc-centre drag back instead of tearing a closed contour', () => {
    const scene = fixture('13-freeform-blob');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const idx = c.segs.findIndex((f) => f.kind === 'arc');
    const arc = c.segs[idx] as ArcFit;
    const before = { ...arc.c };

    const res = moveSegmentCenter(scene, { shape: shape.id, contour: 0, seg: idx }, before.x + 100, before.y + 100, {
      maxResidual: scene.report.tol,
    });

    expect(res.applied).toBe(false);
    expect((c.segs[idx] as ArcFit).c).toEqual(before);
  });

  it('rolls a join drag back instead of tearing a closed contour', () => {
    const scene = fixture('13-freeform-blob');
    const shape = pathShape(scene);
    const c = shape.contours[0];
    const at = segStart(c.segs[0])!;

    const res = moveJoin(scene, { shape: shape.id, contour: 0, seg: 0 }, 'start', at.x + 100, at.y + 100, {
      maxResidual: scene.report.tol,
    });

    expect(res.applied).toBe(false);
    expect(segStart(c.segs[0])!.x).toBeCloseTo(at.x, 9);
    expect(segStart(c.segs[0])!.y).toBeCloseTo(at.y, 9);
  });
});

function circleScene(): Scene {
  const circle = (id: string, x: number, y: number) => ({
    kind: 'circle' as const,
    id,
    c: { x, y },
    r: 10,
    style: { fill: '#000' },
    meta: { confidence: 1, maxDev: 0, from: [] },
  });
  return {
    width: 100,
    height: 100,
    viewBox: [0, 0, 100, 100],
    shapes: [circle('a', 20, 50), circle('b', 80, 50), circle('c', 50, 50)],
    constraints: [],
    report: { tol: 0.1, sourceRegions: 3, kinds: { circle: 3 }, maxDev: 0, primitiveCoverage: 1, notes: [] },
  };
}

describe('whole-shape constrained editing', () => {
  it('preserves only the constrained axis of an alignment', () => {
    const scene = circleScene();
    scene.constraints.push({ kind: 'aligned-h', ids: ['a', 'b'], y: 50 });

    const res = editShapeParams(scene, 'a', { 'c.x': 30, 'c.y': 60 }, { enforce: true });
    const [a, b] = scene.shapes as Extract<Shape, { kind: 'circle' }>[];

    expect(res.applied).toBe(true);
    expect(a.c).toEqual({ x: 30, y: 60 });
    expect(b.c).toEqual({ x: 80, y: 60 });
  });

  it('moves a mirror counterpart while leaving the mirror axis editable', () => {
    const scene = circleScene();
    scene.constraints.push({ kind: 'reflection', axis: { p: { x: 50, y: 0 }, dir: { x: 0, y: 1 } }, ids: ['a', 'b', 'c'] });

    editShapeParams(scene, 'a', { 'c.x': 25, 'c.y': 42 }, { enforce: true });
    let [, b] = scene.shapes as Extract<Shape, { kind: 'circle' }>[];
    expect(b.c).toEqual({ x: 75, y: 42 });

    editShapeParams(scene, 'c', { 'c.x': 55, 'c.y': 50 }, { enforce: true });
    const [a2, b2, c2] = scene.shapes as Extract<Shape, { kind: 'circle' }>[];
    expect(a2.c.x).toBe(30);
    expect(b2.c.x).toBe(80);
    expect(c2.c.x).toBe(55);
    expect(scene.constraints[0]).toMatchObject({ kind: 'reflection', axis: { p: { x: 55 } } });
  });

  it('keeps equal radii linked without locking circle positions', () => {
    const scene = circleScene();
    scene.constraints.push({ kind: 'equal-radius', ids: ['a', 'b'], value: 10 });

    editShapeParam(scene, 'a', 'r', 18, { enforce: true });
    editShapeParams(scene, 'a', { 'c.x': 35, 'c.y': 40 }, { enforce: true });
    const [a, b] = scene.shapes as Extract<Shape, { kind: 'circle' }>[];

    expect(a.r).toBe(18);
    expect(b.r).toBe(18);
    expect(a.c).toEqual({ x: 35, y: 40 });
    expect(b.c).toEqual({ x: 80, y: 50 });
  });
});

describe('editShapeParams atomicity', () => {
  const meta = () => ({ confidence: 1, maxDev: 0, from: [] });
  const blank = (shapes: Shape[]): Scene => ({
    width: 100,
    height: 100,
    viewBox: [0, 0, 100, 100],
    shapes,
    constraints: [],
    report: { tol: 0.1, sourceRegions: 0, kinds: {}, maxDev: 0, primitiveCoverage: 1, notes: [] },
  });

  it('refuses the whole batch when one value is invalid, leaving the shape untouched', () => {
    const scene = blank([{ kind: 'rect', id: 'a', x: 10, y: 10, w: 30, h: 20, rx: 0, rot: 0, style: {}, meta: meta() }]);
    const res = editShapeParams(scene, 'a', { w: 50, h: -1 });
    expect(res.applied).toBe(false);
    const s = scene.shapes[0];
    expect(s.kind === 'rect' && s.w).toBe(30); // w must not have been written before h failed
    expect(s.kind === 'rect' && s.h).toBe(20);
  });

  it('refuses the whole batch on an unknown key', () => {
    const scene = blank([{ kind: 'circle', id: 'a', c: { x: 40, y: 40 }, r: 20, style: {}, meta: meta() }]);
    const res = editShapeParams(scene, 'a', { r: 25, nope: 1 });
    expect(res.applied).toBe(false);
    expect(scene.shapes[0].kind === 'circle' && scene.shapes[0].r).toBe(20);
  });

  it('offers rotation on an axis-aligned rect and applies it', () => {
    const scene = blank([{ kind: 'rect', id: 'a', x: 10, y: 10, w: 30, h: 20, rx: 0, rot: 0, style: {}, meta: meta() }]);
    const fields = shapeFields(scene.shapes[0]);
    expect(fields.some((f) => f.key === 'rot')).toBe(true);
    const res = editShapeParams(scene, 'a', { rot: 30 });
    expect(res.applied).toBe(true);
    expect(scene.shapes[0].kind === 'rect' && scene.shapes[0].rot).toBeCloseTo(Math.PI / 6, 9);
  });
});

describe('editing next to beziers', () => {
  const meta = { confidence: 1, maxDev: 0, from: [] };
  const report = { tol: 0.1, sourceRegions: 1, kinds: {}, maxDev: 0, primitiveCoverage: 1, notes: [] };

  /** Raw sampled cubic: a straight polyline from a to b, n+1 points. */
  const rawCubic = (a: { x: number; y: number }, b: { x: number; y: number }, n = 10) => ({
    kind: 'cubic' as const,
    pts: Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n })),
    maxDev: 0,
    rmsDev: 0,
    params: (n + 1) * 2,
  });

  const sceneWith = (segs: Contour['segs'], closed = false): Scene => ({
    width: 100,
    height: 100,
    viewBox: [0, 0, 100, 100],
    shapes: [{ kind: 'path', id: 'p0', contours: [{ segs, closed, hole: false }], style: { stroke: 'black', strokeWidth: 1 }, meta: { ...meta } }],
    constraints: [],
    report: { ...report },
  });

  it('keeps a raw cubic local when a neighbouring join moves: far end pinned', () => {
    const scene = sceneWith([
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, maxDev: 0, rmsDev: 0, params: 4 },
      rawCubic({ x: 20, y: 0 }, { x: 40, y: 20 }),
    ]);
    const res = moveJoin(scene, { shape: 'p0', contour: 0, seg: 0 }, 'end', 25, 3);
    expect(res.applied).toBe(true);
    const c = pathShape(scene).contours[0];
    const cub = c.segs[1];
    if (cub.kind !== 'cubic') throw new Error('expected cubic');
    expect(cub.pts[0].x).toBeCloseTo(25, 9);
    expect(cub.pts[0].y).toBeCloseTo(3, 9);
    // The far end must not drift — bodily translation is exactly the old bug.
    expect(cub.pts[cub.pts.length - 1]).toEqual({ x: 40, y: 20 });
    expect(maxGap(c)).toBeLessThan(1e-9);
  });

  it('changes an arc radius between two cubics without walking the contour', () => {
    const scene = sceneWith([
      rawCubic({ x: 10, y: 10 }, { x: 25, y: 10 }),
      { kind: 'arc', c: { x: 30, y: 10 }, r: 5, a0: Math.PI, a1: 2 * Math.PI, ccw: false, a: { x: 25, y: 10 }, b: { x: 35, y: 10 }, maxDev: 0, rmsDev: 0, params: 5 },
      rawCubic({ x: 35, y: 10 }, { x: 50, y: 10 }),
    ]);
    const ref = { shape: 'p0', contour: 0, seg: 1 };
    const res = editSegmentParam(scene, ref, 'r', 8);
    expect(res.applied).toBe(true);
    const c = pathShape(scene).contours[0];
    const [c1, arc, c2] = c.segs;
    if (c1.kind !== 'cubic' || arc.kind !== 'arc' || c2.kind !== 'cubic') throw new Error('kinds changed');
    expect(arc.r).toBe(8);
    // Outer ends of the neighbours stay put; only their inner ends follow.
    expect(c1.pts[0]).toEqual({ x: 10, y: 10 });
    expect(c2.pts[c2.pts.length - 1]).toEqual({ x: 50, y: 10 });
    expect(maxGap(c)).toBeLessThan(1e-9);
  });

  it('drags a radius to a stable fixed point next to cubics', () => {
    const scene = sceneWith([
      rawCubic({ x: 10, y: 10 }, { x: 25, y: 10 }),
      { kind: 'arc', c: { x: 30, y: 10 }, r: 5, a0: Math.PI, a1: 2 * Math.PI, ccw: false, a: { x: 25, y: 10 }, b: { x: 35, y: 10 }, maxDev: 0, rmsDev: 0, params: 5 },
      rawCubic({ x: 35, y: 10 }, { x: 50, y: 10 }),
    ]);
    const ref = { shape: 'p0', contour: 0, seg: 1 };
    const at = { x: 30, y: 3 }; // above the arc's apex: asks for r = 7
    expect(editSegmentRadiusAt(scene, ref, at).applied).toBe(true);
    const r1 = (pathShape(scene).contours[0].segs[1] as ArcFit).r;
    expect(editSegmentRadiusAt(scene, ref, at).applied).toBe(true);
    const r2 = (pathShape(scene).contours[0].segs[1] as ArcFit).r;
    // Same pointer position twice must not amplify — that feedback was the bug.
    expect(Math.abs(r2 - r1)).toBeLessThan(1e-6);
    expect(Math.abs(r1 - 7)).toBeLessThan(0.5);
  });

  it('moves an authored bezier endpoint with its control leg', () => {
    const scene = fixtureCurve();
    const res = moveJoin(scene, { shape: 'u0', contour: 0, seg: 0 }, 'end', 60, 40);
    expect(res.applied).toBe(true);
    const s = scene.shapes[0];
    if (s.kind !== 'path' || s.contours[0].segs[0].kind !== 'cubic') throw new Error('shape changed');
    const f = s.contours[0].segs[0];
    expect(f.pts[f.pts.length - 1]).toEqual({ x: 60, y: 40 });
    expect(f.pts[0]).toEqual({ x: 10, y: 10 }); // start untouched
  });

  it('edits a control point without moving the endpoints', () => {
    const scene = fixtureCurve();
    const res = editCubicControl(scene, { shape: 'u0', contour: 0, seg: 0 }, 'c1', { x: 15, y: 40 });
    expect(res.applied).toBe(true);
    const s = scene.shapes[0];
    if (s.kind !== 'path' || s.contours[0].segs[0].kind !== 'cubic') throw new Error('shape changed');
    const f = s.contours[0].segs[0];
    expect(f.c1).toEqual({ x: 15, y: 40 });
    expect(f.pts[0]).toEqual({ x: 10, y: 10 });
    expect(f.pts[f.pts.length - 1]).toEqual({ x: 50, y: 10 });
    const t = segTangent(f, 'start')!;
    // Tangent at the start now points at the moved control point.
    expect(Math.atan2(t.y, t.x)).toBeCloseTo(Math.atan2(30, 5), 6);
  });

  function fixtureCurve(): Scene {
    const scene = sceneWith([]);
    scene.shapes = [];
    createShape(scene, 'curve', { x: 30, y: 10 }, { size: 40 });
    const s = scene.shapes[0];
    if (s.kind !== 'path' || s.contours[0].segs[0].kind !== 'cubic') throw new Error('bad curve');
    return scene;
  }
});
