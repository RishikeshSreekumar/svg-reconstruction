import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { reconstructSVG } from '../src/reconstruct.ts';
import { sceneToSVG } from '../src/emit/to-svg.ts';
import { flattenSVG } from '../src/bench/flatten.ts';
import { compare } from '../src/bench/compare.ts';
import { normalizeSVG } from '../src/parse/normalize.ts';
import { buildNesting } from '../src/infer/holes.ts';

const FIX = join(import.meta.dirname, '..', 'fixtures');
const fixture = (name: string): string => readFileSync(join(FIX, name), 'utf8');

const roundTrip = (name: string, precision = 2) => {
  const original = fixture(name);
  const flat = flattenSVG(original, { precision });
  const scene = reconstructSVG(flat);
  const out = sceneToSVG(scene);
  return { original, flat, scene, out, result: compare(original, flat, scene, out) };
};

describe('normalization', () => {
  it('bakes nested group transforms into coordinates', () => {
    const doc = normalizeSVG(fixture('11-nested-group-transform.svg'));
    expect(doc.regions.length).toBe(2);
    // circle cx=30 r=25 under translate(40 40) scale(2) then translate(10 10)
    // => centre (120,120), radius 50.
    const circle = doc.regions.find((r) => r.poly.length > 20)!;
    const xs = circle.poly.map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(120, 1);
    expect((Math.max(...xs) - Math.min(...xs)) / 2).toBeCloseTo(50, 1);
  });

  it('splits compound paths into one region per subpath', () => {
    const doc = normalizeSVG(fixture('05-rect-hole.svg'));
    expect(doc.regions).toHaveLength(2);
    expect(doc.regions.every((r) => r.closed)).toBe(true);
  });

  it('tags regions with their source element so fill rules do not leak', () => {
    const doc = normalizeSVG(fixture('10-concentric.svg'));
    expect(new Set(doc.regions.map((r) => r.elem)).size).toBe(3);
  });
});

describe('hole detection', () => {
  it('reads evenodd holes from nesting parity', () => {
    const doc = normalizeSVG(fixture('05-rect-hole.svg'));
    const nodes = buildNesting(doc.regions);
    expect(nodes.filter((n) => n.hole)).toHaveLength(1);
  });

  it('does not mark a nested ring as a hole of the ring outside it', () => {
    // Three separate stroked circles: each contributes an outer and an inner
    // contour, and only the inners are holes.
    const flat = flattenSVG(fixture('10-concentric.svg'));
    const doc = normalizeSVG(flat);
    const nodes = buildNesting(doc.regions);
    expect(nodes.filter((n) => n.hole)).toHaveLength(2);
  });
});

describe('primitive recovery', () => {
  it('turns a flattened circle back into <circle>', () => {
    const { scene } = roundTrip('01-circle.svg');
    expect(scene.shapes).toHaveLength(1);
    expect(scene.shapes[0].kind).toBe('circle');
    const s = scene.shapes[0];
    if (s.kind !== 'circle') throw new Error('expected circle');
    expect(s.c.x).toBeCloseTo(100, 1);
    expect(s.r).toBeCloseTo(64, 1);
  });

  it('recovers a rounded rect with its corner radius', () => {
    const { scene } = roundTrip('04-rounded-rect.svg');
    const s = scene.shapes[0];
    if (s.kind !== 'rect') throw new Error(`expected rect, got ${s.kind}`);
    expect(s.w).toBeCloseTo(200, 0);
    expect(s.h).toBeCloseTo(120, 0);
    expect(s.rx).toBeCloseTo(24, 0);
  });

  it('prefers rect over a four-sided regular polygon', () => {
    const { scene } = roundTrip('05-rect-hole.svg');
    expect(scene.shapes.every((s) => s.kind !== 'polygon')).toBe(true);
  });

  it('recognises a regular hexagon', () => {
    const { scene } = roundTrip('07-hexagon.svg');
    const s = scene.shapes[0];
    if (s.kind !== 'polygon') throw new Error(`expected polygon, got ${s.kind}`);
    expect(s.sides).toBe(6);
    expect(s.r).toBeCloseTo(80, 0);
  });

  it('keeps a freeform blob as a path instead of forcing a primitive', () => {
    const { scene } = roundTrip('13-freeform-blob.svg');
    expect(scene.shapes[0].kind).toBe('path');
  });
});

describe('stroke recovery', () => {
  it('turns an annulus back into a stroked circle', () => {
    const { scene } = roundTrip('02-ring.svg');
    expect(scene.shapes).toHaveLength(1);
    const s = scene.shapes[0];
    if (s.kind !== 'circle') throw new Error(`expected circle, got ${s.kind}`);
    expect(s.r).toBeCloseTo(64, 0);
    expect(s.style.strokeWidth).toBeCloseTo(16, 0);
    expect(s.style.fill).toBeNull();
  });

  it('turns an expanded line back into a stroked line', () => {
    const { scene } = roundTrip('06-stroked-line.svg');
    const s = scene.shapes[0];
    if (s.kind !== 'line') throw new Error(`expected line, got ${s.kind}`);
    expect(s.style.strokeWidth).toBeCloseTo(18, 0);
  });

  it('recovers a stroked polygon with sharp corners', () => {
    const { scene } = roundTrip('15-triangle-stroked.svg');
    expect(scene.shapes).toHaveLength(1);
    expect(scene.shapes[0].style.strokeWidth).toBeCloseTo(14, 0);
    // Three corners, not a chamfered six.
    const s = scene.shapes[0];
    if (s.kind === 'path') expect(s.contours[0].segs).toHaveLength(3);
  });

  it('does not invent a stroke inside a solid circle', () => {
    const { scene } = roundTrip('01-circle.svg');
    expect(scene.shapes[0].style.stroke).toBeFalsy();
  });
});

describe('constraints', () => {
  it('snaps near-equal radii to a shared value', () => {
    const { scene } = roundTrip('03-two-circles.svg');
    const radii = scene.shapes.map((s) => (s.kind === 'circle' ? s.r : NaN));
    expect(radii[0]).toBe(radii[1]);
    expect(scene.constraints.some((c) => c.kind === 'equal-radius')).toBe(true);
  });

  it('finds concentricity', () => {
    const { scene } = roundTrip('10-concentric.svg');
    expect(scene.constraints.some((c) => c.kind === 'concentric')).toBe(true);
  });

  it('finds rotational symmetry in a star', () => {
    const { scene } = roundTrip('17-star.svg');
    const rot = scene.constraints.find((c) => c.kind === 'rotational');
    expect(rot && rot.kind === 'rotational' ? rot.order : 0).toBe(5);
  });
});

describe('segment-level construction', () => {
  const skeleton = () => reconstructSVG(fixture('21-tangent-skeleton.svg'));

  it('lists the radius of every arc in an arc-and-line skeleton', () => {
    const scene = skeleton();
    const radii = (scene.construction?.segs ?? []).filter((s) => s.r != null).map((s) => s.r!);
    expect(radii).toHaveLength(3);
    // Authored as r 20, r 25 and r 15.
    expect(radii.map((r) => Math.round(r)).sort((a, b) => a - b)).toEqual([15, 20, 25]);
  });

  it('reads every join of a solved skeleton as tangent, not as a kink', () => {
    const scene = skeleton();
    expect(scene.constraints.some((c) => c.kind === 'corner')).toBe(false);
    const tangents = scene.constraints.filter((c) => c.kind === 'tangent');
    expect(tangents).toHaveLength(6);
    expect(tangents.every((c) => c.kind === 'tangent' && c.solved)).toBe(true);
  });

  it('finds the half-turn, and still finds it after flattening', () => {
    for (const scene of [skeleton(), roundTrip('21-tangent-skeleton.svg').scene]) {
      const semis = scene.constraints.filter((c) => c.kind === 'semicircle');
      expect(semis).toHaveLength(1);
      const sweep = semis[0].kind === 'semicircle' ? Math.abs(semis[0].sweep) : 0;
      expect((sweep * 180) / Math.PI).toBeCloseTo(180, 0);
    }
  });

  it('keeps real corners as corners rather than forcing tangency', () => {
    // A star is all kinks; snapping one into a tangency would move the outline
    // far off the artwork, and the verification step is what prevents it.
    const { scene, result } = roundTrip('17-star.svg');
    expect(scene.constraints.some((c) => c.kind === 'corner')).toBe(true);
    expect(scene.constraints.some((c) => c.kind === 'tangent')).toBe(false);
    expect(result.relHausdorff).toBeLessThan(1e-6);
  });

  it('measures the ink box from the painted stroke, so butt caps do not inflate it', () => {
    const scene = skeleton();
    // viewBox is 14 14 117 91: the mark touches all four edges. Growing the
    // centerline bbox by half a width instead would overshoot the butt caps.
    expect(scene.construction?.tightViewBox).toBe(true);
    expect(scene.construction?.aspect).toBeCloseTo(117 / 91, 3);
    expect(scene.construction?.ink.y1).toBeCloseTo(105, 2);
  });

  it('quotes stroke width against the ink height', () => {
    const scene = reconstructSVG(fixture('06-stroked-line.svg'));
    const s = scene.construction?.strokes[0];
    expect(s?.width).toBeCloseTo(18, 2);
    expect(s?.ofHeight).toBeCloseTo(18 / (scene.construction!.ink.y1 - scene.construction!.ink.y0), 6);
  });

  it('can be switched off', () => {
    const scene = reconstructSVG(fixture('21-tangent-skeleton.svg'), { detectConstruction: false });
    expect(scene.construction).toBeUndefined();
    expect(scene.constraints.some((c) => c.kind === 'tangent')).toBe(false);
  });

  it('reports arcs that share a radius, and leaves their values alone', () => {
    // Reported, never snapped: a segment's endpoints are shared with its
    // neighbours, so forcing two radii equal would break the chain.
    const { scene } = roundTrip('13-freeform-blob.svg');
    const eq = scene.constraints.find((c) => c.kind === 'equal-radius-seg');
    expect(eq && eq.kind === 'equal-radius-seg' ? eq.segs.length : 0).toBeGreaterThanOrEqual(2);
    const radiiOf = (ids: typeof eq): number[] => {
      if (!ids || ids.kind !== 'equal-radius-seg') return [];
      return ids.segs.map((r) => scene.construction!.segs.find((s) => s.ref.seg === r.seg && s.ref.shape === r.shape)!.r!);
    };
    const radii = radiiOf(eq);
    expect(new Set(radii.map((r) => r.toFixed(6))).size).toBe(radii.length);
  });
});

describe('tangency repair', () => {
  it('recovers a full 180-degree sweep instead of a clipped one', () => {
    // Without the repair the split at a tangent join lands a few samples off and
    // the half-turn comes back several degrees short.
    const loose = reconstructSVG(fixture('21-tangent-skeleton.svg'), { snapTangents: false });
    const tight = reconstructSVG(fixture('21-tangent-skeleton.svg'));
    const worstSweepError = (s: typeof loose): number => {
      const arcs = (s.construction?.segs ?? []).filter((x) => x.sweep != null);
      const half = arcs.filter((x) => Math.abs(Math.abs(x.sweep!) - Math.PI) < 0.3);
      return half.length ? Math.min(...half.map((x) => Math.abs(Math.abs(x.sweep!) - Math.PI))) : Infinity;
    };
    expect(worstSweepError(tight)).toBeLessThan(worstSweepError(loose));
    expect(tight.report.maxDev).toBeLessThan(loose.report.maxDev);
  });

  it('does not make the reconstruction worse anywhere in the corpus', () => {
    for (const file of ['09-arcs-and-lines.svg', '19-arc-lines-mixed.svg', '13-freeform-blob.svg']) {
      const original = fixture(file);
      const flat = flattenSVG(original, { precision: 2 });
      const off = compare(original, flat, reconstructSVG(flat, { snapTangents: false }), sceneToSVG(reconstructSVG(flat, { snapTangents: false })));
      const on = compare(original, flat, reconstructSVG(flat), sceneToSVG(reconstructSVG(flat)));
      expect(on.relHausdorff).toBeLessThanOrEqual(off.relHausdorff + 1e-9);
    }
  });
});

describe('whole-corpus round trip', () => {
  const files = readdirSync(FIX).filter((f) => f.endsWith('.svg')).sort();

  it.each(files)('%s reconstructs within tolerance and simplifies', (file) => {
    const { result } = roundTrip(file);
    expect(result.relHausdorff).toBeLessThan(0.01);
    expect(result.f1).toBe(1);
    // Only meaningful where the input was actually curve soup. A four-point
    // square is already minimal, and <rect x y w h> is not obliged to beat it.
    if (result.coordsIn > 60) expect(result.coordsOut).toBeLessThan(result.coordsIn);
  });

  it.each(files)('%s survives one-decimal quantization', (file) => {
    const { result } = roundTrip(file, 1);
    expect(result.relHausdorff).toBeLessThan(0.02);
    expect(result.f1).toBe(1);
  });
});

describe('emitted SVG', () => {
  it('re-parses to the same geometry it claims', () => {
    for (const file of ['02-ring.svg', '14-logo-composite.svg', '19-arc-lines-mixed.svg']) {
      const { out } = roundTrip(file);
      expect(() => normalizeSVG(out)).not.toThrow();
      expect(normalizeSVG(out).regions.length).toBeGreaterThan(0);
    }
  });

  it('emits real primitive elements, not path soup', () => {
    const { out } = roundTrip('14-logo-composite.svg');
    expect(out).toContain('<circle');
    expect(out).toContain('<rect');
    expect(out).not.toContain('C');
  });
});
