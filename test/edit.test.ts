import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reconstructSVG } from '../src/reconstruct.ts';
import { flattenSVG } from '../src/bench/flatten.ts';
import { sceneToSVG } from '../src/emit/to-svg.ts';
import {
  editSegmentParam,
  editShapeParam,
  editShapeParams,
  moveJoin,
  moveSegmentCenter,
  rebuildConstruction,
  segmentFields,
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
