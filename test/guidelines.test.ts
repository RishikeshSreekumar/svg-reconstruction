import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reconstructSVG } from '../src/reconstruct.ts';
import { flattenSVG } from '../src/bench/flatten.ts';
import { inferGuidelines } from '../src/infer/guidelines.ts';
import type { Guideline, Scene } from '../src/types.ts';

const fixture = (name: string): Scene => reconstructSVG(flattenSVG(readFileSync(`fixtures/${name}.svg`, 'utf8')));

describe('inferGuidelines', () => {
  it('derives centre cross-hairs and mirror axes from concentric artwork', () => {
    const scene = fixture('10-concentric');
    const gs = inferGuidelines(scene);
    expect(gs.length).toBeGreaterThan(0);
    expect(gs.some((g) => g.kind === 'point' && g.role === 'center')).toBe(true);
    // Concentric circles are mirror-symmetric both ways.
    expect(gs.some((g) => g.kind === 'v' && g.role === 'mirror')).toBe(true);
    expect(gs.some((g) => g.kind === 'h' && g.role === 'mirror')).toBe(true);
  });

  it('derives tangent lines from solved tangencies', () => {
    const scene = fixture('21-tangent-skeleton');
    expect(scene.constraints.some((c) => c.kind === 'tangent' && c.solved)).toBe(true);
    const gs = inferGuidelines(scene);
    expect(gs.some((g) => g.role === 'tangent' && g.kind === 'angled')).toBe(true);
  });

  it('always includes the ink bbox edges', () => {
    const scene = fixture('01-circle');
    const gs = inferGuidelines(scene);
    expect(gs.filter((g) => g.role === 'bbox')).toHaveLength(4);
  });

  it('dedupes coincident guides and keeps the stronger role', () => {
    const scene = fixture('10-concentric');
    const gs = inferGuidelines(scene);
    const vs = gs.filter((g): g is Extract<Guideline, { kind: 'v' }> => g.kind === 'v');
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        expect(Math.abs(vs[i].x - vs[j].x)).toBeGreaterThan(scene.report.tol * 2);
      }
    }
  });

  it('mints sequential ids and marks everything inferred', () => {
    const gs = inferGuidelines(fixture('14-logo-composite'));
    gs.forEach((g, i) => {
      expect(g.id).toBe(`g${i}`);
      expect(g.source).toBe('inferred');
    });
  });
});
