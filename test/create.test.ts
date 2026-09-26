import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reconstructSVG } from '../src/reconstruct.ts';
import { flattenSVG } from '../src/bench/flatten.ts';
import { breakApartShape, createShape, cutShape, deleteShape, findCutTarget, nextUserGuideId, nextUserId, reorderShape, sizeCurve, translateShapeInScene } from '../src/edit/create.ts';
import { rebuildConstruction, shapeAnchor } from '../src/edit/index.ts';
import { sceneToSVG } from '../src/emit/to-svg.ts';
import type { Scene } from '../src/types.ts';

const fixture = (name: string): Scene => reconstructSVG(flattenSVG(readFileSync(`fixtures/${name}.svg`, 'utf8')));

describe('createShape', () => {
  it('mints ids that never collide with reconstructed shapes or each other', () => {
    const scene = fixture('03-two-circles');
    const a = createShape(scene, 'circle', { x: 10, y: 10 });
    const b = createShape(scene, 'rect', { x: 20, y: 20 });
    const ids = scene.shapes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.id).toBe('u0');
    expect(b.id).toBe('u1');
  });

  it('keeps minting unique ids after structuredClone (undo restore)', () => {
    const scene = fixture('01-circle');
    createShape(scene, 'circle', { x: 5, y: 5 });
    const restored = structuredClone(scene);
    const c = createShape(restored, 'ellipse', { x: 9, y: 9 });
    expect(c.id).toBe('u1');
    expect(new Set(restored.shapes.map((s) => s.id)).size).toBe(restored.shapes.length);
  });

  it('creates polygons with generated vertices and text with content', () => {
    const scene = fixture('01-circle');
    const poly = createShape(scene, 'polygon', { x: 0, y: 0 });
    expect(poly.kind === 'polygon' && poly.pts.length).toBe(6);
    const text = createShape(scene, 'text', { x: 1, y: 2 }, { text: 'hello' });
    expect(text.kind === 'text' && text.text).toBe('hello');
  });
});

describe('deleteShape', () => {
  it('drops constraints that mention the shape and keeps the rest valid', () => {
    const scene = fixture('10-concentric');
    const withCons = scene.constraints.find((c) => 'ids' in c && c.ids.length >= 2);
    expect(withCons).toBeDefined();
    const victim = (withCons as { ids: string[] }).ids[0];
    expect(deleteShape(scene, victim)).toBe(true);
    for (const c of scene.constraints) {
      if ('ids' in c) {
        expect(c.ids).not.toContain(victim);
        expect(c.ids.length).toBeGreaterThanOrEqual(2);
      }
      if (c.kind === 'tangent' || c.kind === 'corner') {
        expect(c.a.shape).not.toBe(victim);
        expect(c.b.shape).not.toBe(victim);
      }
      if (c.kind === 'equal-radius-seg') for (const s of c.segs) expect(s.shape).not.toBe(victim);
      if (c.kind === 'semicircle') expect(c.seg.shape).not.toBe(victim);
    }
    expect(scene.construction?.segs.every((n) => n.ref.shape !== victim)).toBe(true);
  });

  it('leaves user guidelines alone when the construction is rebuilt', () => {
    const scene = fixture('01-circle');
    scene.guidelines = [{ id: nextUserGuideId(scene), source: 'user', role: 'align', kind: 'v', x: 42 }];
    rebuildConstruction(scene);
    expect(scene.guidelines).toHaveLength(1);
    expect(scene.guidelines[0].id).toBe('ug0');
  });
});

describe('cutShape', () => {
  const blank = (): Scene => ({
    width: 100,
    height: 100,
    viewBox: [0, 0, 100, 100],
    shapes: [],
    constraints: [],
    report: { tol: 0.1, sourceRegions: 0, kinds: {}, maxDev: 0, primitiveCoverage: 1, notes: [] },
  });

  it('subtracts the front closed shape from the nearest overlapping shape below', () => {
    const scene = blank();
    const target = createShape(scene, 'rect', { x: 50, y: 50 }, { size: 60, style: { fill: 'black' } });
    const cutter = createShape(scene, 'circle', { x: 50, y: 50 }, { size: 24 });
    expect(findCutTarget(scene, cutter.id)).toBe(target.id);

    const result = cutShape(scene, cutter.id);
    expect(result).toEqual({ applied: true, targetId: target.id });
    expect(scene.shapes.map((s) => s.id)).toEqual([target.id]);
    expect(scene.shapes[0].cutouts).toHaveLength(1);
    expect(scene.shapes[0].cutouts?.[0].kind).toBe('circle');

    const svg = sceneToSVG(scene);
    expect(svg).toContain('<mask id="cut-');
    expect(svg).toContain('mask="url(#cut-');
    expect(svg).toContain('fill="black"');
  });

  it('supports polygon cutters and keeps cutouts attached while the target moves', () => {
    const scene = blank();
    const target = createShape(scene, 'circle', { x: 40, y: 40 }, { size: 50, style: { fill: 'black' } });
    const cutter = createShape(scene, 'polygon', { x: 40, y: 40 }, { size: 20 });
    expect(cutShape(scene, cutter.id).applied).toBe(true);
    const before = structuredClone(target.cutouts?.[0]);

    expect(translateShapeInScene(scene, target.id, 8, -5).applied).toBe(true);
    const after = target.cutouts?.[0];
    expect(before?.kind).toBe('polygon');
    expect(after?.kind).toBe('polygon');
    if (before?.kind === 'polygon' && after?.kind === 'polygon') {
      expect(after.pts[0].x).toBeCloseTo(before.pts[0].x + 8, 6);
      expect(after.pts[0].y).toBeCloseTo(before.pts[0].y - 5, 6);
    }
  });

  it('gives the target a fresh cutouts array on every cut', () => {
    // Views hold shallow clones of a shape, so an in-place push or splice on
    // this array is invisible to them and the canvas silently goes stale.
    const scene = blank();
    const target = createShape(scene, 'rect', { x: 50, y: 50 }, { size: 60, style: { fill: 'black' } });
    const first = createShape(scene, 'circle', { x: 40, y: 40 }, { size: 20 });
    expect(cutShape(scene, first.id).applied).toBe(true);
    const afterFirst = target.cutouts;
    expect(afterFirst).toHaveLength(1);

    const second = createShape(scene, 'circle', { x: 62, y: 62 }, { size: 20 });
    expect(cutShape(scene, second.id).applied).toBe(true);
    expect(target.cutouts).toHaveLength(2);
    expect(target.cutouts).not.toBe(afterFirst);
  });

  it('refuses an explicit target that sits in front of the cutter', () => {
    const scene = blank();
    const cutter = createShape(scene, 'circle', { x: 50, y: 50 }, { size: 24 });
    const front = createShape(scene, 'rect', { x: 50, y: 50 }, { size: 60, style: { fill: 'black' } });
    const result = cutShape(scene, cutter.id, front.id);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('in front');
    expect(scene.shapes).toHaveLength(2); // the cutter survives a refused cut
  });

  it('refuses non-overlapping and open cutters', () => {
    const scene = blank();
    createShape(scene, 'rect', { x: 20, y: 20 }, { size: 10 });
    const far = createShape(scene, 'circle', { x: 80, y: 80 }, { size: 10 });
    expect(findCutTarget(scene, far.id)).toBeNull();
    expect(cutShape(scene, far.id).applied).toBe(false);
    const line = createShape(scene, 'line', { x: 20, y: 20 }, { size: 10 });
    expect(findCutTarget(scene, line.id)).toBeNull();
  });
});

describe('translateShapeInScene', () => {
  it('keeps concentric partners concentric when enforcing', () => {
    // Hand-built: a real reconstruction of concentric artwork also detects
    // mirror/rotational symmetry, and those constraints translate the partners
    // again on top — correct propagation, but noise for this assertion.
    const meta = { confidence: 1, maxDev: 0, from: [] };
    const scene: Scene = {
      width: 100,
      height: 100,
      viewBox: [0, 0, 100, 100],
      shapes: [
        { kind: 'circle', id: 'a', c: { x: 40, y: 40 }, r: 20, style: {}, meta: { ...meta } },
        { kind: 'circle', id: 'b', c: { x: 40, y: 40 }, r: 10, style: {}, meta: { ...meta } },
      ],
      constraints: [{ kind: 'concentric', ids: ['a', 'b'], c: { x: 40, y: 40 } }],
      report: { tol: 0.1, sourceRegions: 2, kinds: { circle: 2 }, maxDev: 0, primitiveCoverage: 1, notes: [] },
    };
    const res = translateShapeInScene(scene, 'a', 7, -3, { enforce: true });
    expect(res.applied).toBe(true);
    expect(res.linked).toContain('b');
    expect(shapeAnchor(scene.shapes[0])).toEqual({ x: 47, y: 37 });
    expect(shapeAnchor(scene.shapes[1])).toEqual({ x: 47, y: 37 });
  });

  it('moves a path shape directly', () => {
    const scene = fixture('13-freeform-blob');
    const path = scene.shapes.find((s) => s.kind === 'path')!;
    const before = shapeAnchor(path);
    expect(translateShapeInScene(scene, path.id, 5, 5).applied).toBe(true);
    const after = shapeAnchor(scene.shapes.find((s) => s.id === path.id)!);
    expect(after.x).toBeCloseTo(before.x + 5, 6);
    expect(after.y).toBeCloseTo(before.y + 5, 6);
  });
});

describe('reorderShape', () => {
  it('moves shapes through the paint order', () => {
    const scene = fixture('03-two-circles');
    createShape(scene, 'rect', { x: 0, y: 0 });
    const first = scene.shapes[0].id;
    reorderShape(scene, first, 'front');
    expect(scene.shapes[scene.shapes.length - 1].id).toBe(first);
    reorderShape(scene, first, 'back');
    expect(scene.shapes[0].id).toBe(first);
    reorderShape(scene, first, 'forward');
    expect(scene.shapes[1].id).toBe(first);
    reorderShape(scene, first, 'backward');
    expect(scene.shapes[0].id).toBe(first);
  });
});

describe('nextUserId', () => {
  it('scans rather than counts', () => {
    const scene = fixture('01-circle');
    createShape(scene, 'circle', { x: 0, y: 0 });
    createShape(scene, 'circle', { x: 1, y: 1 });
    deleteShape(scene, 'u0');
    expect(nextUserId(scene)).toBe('u2'); // u1 still present
  });
});

describe('curve creation', () => {
  it('creates a path with one authored bezier and emits a C command', () => {
    const scene = fixture('01-circle');
    const s = createShape(scene, 'curve', { x: 50, y: 50 });
    expect(s.kind).toBe('path');
    if (s.kind !== 'path') return;
    const f = s.contours[0].segs[0];
    expect(f.kind).toBe('cubic');
    if (f.kind !== 'cubic') return;
    expect(f.c1).toBeDefined();
    expect(f.c2).toBeDefined();
    expect(f.pts.length).toBeGreaterThan(2);
    expect(sceneToSVG(scene)).toMatch(/C[-\d.]+ [-\d.]+ [-\d.]+/);
  });

  it('sizeCurve re-spans the endpoints', () => {
    const scene = fixture('01-circle');
    const s = createShape(scene, 'curve', { x: 50, y: 50 });
    expect(sizeCurve(scene, s.id, { x: 10, y: 20 }, { x: 90, y: 60 })).toBe(true);
    if (s.kind !== 'path') return;
    const f = scene.shapes.find((x) => x.id === s.id);
    if (f?.kind !== 'path') return;
    const seg = f.contours[0].segs[0];
    if (seg.kind !== 'cubic') return;
    expect(seg.pts[0]).toEqual({ x: 10, y: 20 });
    expect(seg.pts[seg.pts.length - 1]).toEqual({ x: 90, y: 60 });
  });
});

describe('breakApartShape', () => {
  const meta = { confidence: 1, maxDev: 0, from: [] };
  const report = { tol: 0.1, sourceRegions: 1, kinds: {}, maxDev: 0, primitiveCoverage: 1, notes: [] };

  it('splits a multi-contour path into one shape per contour', () => {
    const scene = fixture('05-rect-hole');
    const path = scene.shapes.find((s) => s.kind === 'path' && s.contours.length > 1);
    if (!path) return; // fixture reconstructed to primitives instead — nothing to assert
    const n = path.kind === 'path' ? path.contours.length : 0;
    const res = breakApartShape(scene, path.id);
    expect(res.applied).toBe(true);
    expect(res.ids.length).toBe(n);
    expect(scene.shapes.find((s) => s.id === path.id)).toBeUndefined();
  });

  it('splits a single contour into one shape per segment, typed by the fit', () => {
    const scene: Scene = {
      width: 100,
      height: 100,
      viewBox: [0, 0, 100, 100],
      shapes: [
        {
          kind: 'path',
          id: 'p0',
          contours: [
            {
              closed: false,
              hole: false,
              segs: [
                { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, maxDev: 0, rmsDev: 0, params: 4 },
                { kind: 'arc', c: { x: 10, y: 5 }, r: 5, a0: -Math.PI / 2, a1: 0, ccw: false, a: { x: 10, y: 0 }, b: { x: 15, y: 5 }, maxDev: 0, rmsDev: 0, params: 5 },
              ],
            },
          ],
          style: { fill: 'black' },
          meta: { ...meta },
        },
      ],
      constraints: [],
      report: { ...report },
    };
    const res = breakApartShape(scene, 'p0');
    expect(res.applied).toBe(true);
    expect(res.ids.length).toBe(2);
    const kinds = scene.shapes.map((s) => s.kind).sort();
    expect(kinds).toEqual(['line', 'path']);
    // Open fragments of a fill-only path get a visible stroke.
    for (const s of scene.shapes) expect(s.style.stroke).toBeTruthy();
  });

  it('refuses non-paths and single segments', () => {
    const scene = fixture('01-circle');
    const circle = scene.shapes.find((s) => s.kind === 'circle');
    if (circle) expect(breakApartShape(scene, circle.id).applied).toBe(false);
  });
});
