import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reconstructSVG } from '../src/reconstruct.ts';
import { flattenSVG } from '../src/bench/flatten.ts';
import { createShape, deleteShape, nextUserGuideId, nextUserId, reorderShape, translateShapeInScene } from '../src/edit/create.ts';
import { rebuildConstruction, shapeAnchor } from '../src/edit/index.ts';
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
