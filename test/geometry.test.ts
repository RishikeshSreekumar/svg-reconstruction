import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/types.ts';
import { fitArc, fitCircle, fitEllipse, fitLine, taubinCircle } from '../src/fit/primitives.ts';
import { expandStroke, offsetSide } from '../src/geom/offset.ts';
import { bboxDiag, bboxOf, densify, hausdorff, resample, signedArea } from '../src/geom/poly.ts';
import { parseTransform, apply } from '../src/geom/mat.ts';
import { endpointToCenter } from '../src/geom/arc.ts';

const circlePts = (cx: number, cy: number, r: number, n = 128, a0 = 0, span = Math.PI * 2): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = a0 + (span * i) / (n - 1);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

describe('circle fitting', () => {
  it('recovers an exact full circle', () => {
    const f = fitCircle(circlePts(120, 80, 40))!;
    expect(f.c.x).toBeCloseTo(120, 6);
    expect(f.c.y).toBeCloseTo(80, 6);
    expect(f.r).toBeCloseTo(40, 6);
    expect(f.maxDev).toBeLessThan(1e-6);
  });

  it('recovers a short arc without the bias naive least squares has', () => {
    // A 40-degree arc: the case where an algebraic fit that is not Taubin drifts.
    const f = fitCircle(circlePts(0, 0, 100, 64, 0.3, Math.PI / 4.5))!;
    expect(f.r).toBeCloseTo(100, 3);
    expect(f.c.x).toBeCloseTo(0, 3);
  });

  it('returns null for collinear points instead of an absurd radius', () => {
    const line: Pt[] = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 3 * i }));
    expect(taubinCircle(line)).toBeNull();
  });

  it('survives coordinate quantization', () => {
    const q = circlePts(150, 150, 62).map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
    const f = fitCircle(q)!;
    expect(f.r).toBeCloseTo(62, 1);
    expect(f.maxDev).toBeLessThan(0.1);
  });
});

describe('arc fitting', () => {
  it('recovers centre, radius and sweep direction', () => {
    const f = fitArc(circlePts(10, 20, 30, 64, 0.5, Math.PI / 2))!;
    expect(f.r).toBeCloseTo(30, 4);
    expect(f.ccw).toBe(true);
    expect(f.a1 - f.a0).toBeCloseTo(Math.PI / 2, 3);
  });

  it('rejects samples that double back', () => {
    const half = circlePts(0, 0, 50, 40, 0, Math.PI);
    expect(fitArc([...half, ...half.slice().reverse()])).toBeNull();
  });
});

describe('line fitting', () => {
  it('handles vertical lines (no y = mx + b assumption)', () => {
    const pts: Pt[] = Array.from({ length: 30 }, (_, i) => ({ x: 42, y: i * 3 }));
    const f = fitLine(pts)!;
    expect(f.maxDev).toBeLessThan(1e-9);
    expect(f.a.x).toBeCloseTo(42, 9);
    expect(f.b.x).toBeCloseTo(42, 9);
  });
});

describe('ellipse fitting', () => {
  it('recovers axes and rotation, with rx as the major axis', () => {
    const rot = 0.6;
    const pts: Pt[] = Array.from({ length: 160 }, (_, i) => {
      const t = (i / 160) * Math.PI * 2;
      const x = 90 * Math.cos(t);
      const y = 40 * Math.sin(t);
      return { x: 200 + Math.cos(rot) * x - Math.sin(rot) * y, y: 150 + Math.sin(rot) * x + Math.cos(rot) * y };
    });
    const f = fitEllipse(pts)!;
    expect(f.maxDev).toBeLessThan(1e-4);
    expect(f.rx).toBeCloseTo(90, 3);
    expect(f.ry).toBeCloseTo(40, 3);
    expect(Math.abs(Math.sin(f.rot - rot))).toBeLessThan(1e-4);
  });

  it('does not claim an ellipse for a circle-with-a-corner', () => {
    const pts = [...circlePts(0, 0, 50, 60, 0, Math.PI), { x: 0, y: 0 }, { x: 50, y: 0 }];
    const f = fitEllipse(pts);
    if (f) expect(f.maxDev).toBeGreaterThan(1);
  });
});

describe('stroke offsetting', () => {
  it('a round join sweeps the short way, never the long way', () => {
    // Two nearly-parallel segments: the join must add a tiny arc, not a full circle.
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 1 }];
    const off = offsetSide(pts, 10, 'round');
    const bb = bboxOf(off);
    expect(bb.y1 - bb.y0).toBeLessThan(15);
  });

  it('expands a closed centerline into two concentric loops', () => {
    const centre = circlePts(0, 0, 50);
    const [outer, inner] = expandStroke(centre, 20, true, 'butt', 'round');
    const ro = bboxDiag(bboxOf(outer)) / 2 / Math.SQRT2;
    const ri = bboxDiag(bboxOf(inner)) / 2 / Math.SQRT2;
    expect(Math.max(ro, ri)).toBeCloseTo(60, 0);
    expect(Math.min(ro, ri)).toBeCloseTo(40, 0);
  });

  it('leaves no spike at a concave join', () => {
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const off = offsetSide(pts, 10, 'round');
    // The concave side must stay inside a modest box; a spike would escape it.
    for (const p of off) {
      expect(p.x).toBeGreaterThan(-15);
      expect(p.y).toBeLessThan(115);
    }
  });
});

describe('polyline utilities', () => {
  it('densify keeps every original vertex', () => {
    const square: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }];
    const d = densify(square, 5);
    for (const v of square) {
      expect(d.some((p) => Math.hypot(p.x - v.x, p.y - v.y) < 1e-9)).toBe(true);
    }
    expect(d.length).toBeGreaterThan(60);
  });

  it('resample preserves endpoints and total extent', () => {
    const pts = circlePts(0, 0, 10, 50, 0, Math.PI);
    const r = resample(pts, 17);
    expect(r).toHaveLength(17);
    expect(r[0]).toEqual(pts[0]);
    expect(r[16].x).toBeCloseTo(pts[pts.length - 1].x, 9);
  });

  it('signed area flips with winding', () => {
    const sq: Pt[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }];
    expect(Math.abs(signedArea(sq))).toBeCloseTo(100, 9);
    expect(Math.sign(signedArea(sq))).toBe(-Math.sign(signedArea(sq.slice().reverse())));
  });

  it('hausdorff is symmetric and catches a single spike', () => {
    const a = circlePts(0, 0, 10, 40);
    const b = a.map((p, i) => (i === 20 ? { x: p.x + 5, y: p.y } : p));
    expect(hausdorff(a, b)).toBeCloseTo(hausdorff(b, a), 9);
    expect(hausdorff(a, b)).toBeGreaterThan(1);
  });
});

describe('transforms and arcs', () => {
  it('composes transform lists left to right', () => {
    const m = parseTransform('translate(10 20) scale(2)');
    expect(apply(m, { x: 3, y: 4 })).toEqual({ x: 16, y: 28 });
  });

  it('rotate about a point leaves that point fixed', () => {
    const m = parseTransform('rotate(37 50 60)');
    const p = apply(m, { x: 50, y: 60 });
    expect(p.x).toBeCloseTo(50, 9);
    expect(p.y).toBeCloseTo(60, 9);
  });

  it('converts endpoint arcs to centre form', () => {
    const arc = endpointToCenter({ x: 100, y: 50 }, 50, 50, 0, false, true, { x: 0, y: 50 })!;
    expect(arc.c.x).toBeCloseTo(50, 9);
    expect(arc.c.y).toBeCloseTo(50, 9);
    expect(Math.abs(arc.delta)).toBeCloseTo(Math.PI, 9);
  });

  it('scales out-of-range radii up rather than failing', () => {
    const arc = endpointToCenter({ x: 0, y: 0 }, 1, 1, 0, false, true, { x: 100, y: 0 })!;
    expect(arc.rx).toBeCloseTo(50, 6);
  });
});
