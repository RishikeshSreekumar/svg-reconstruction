import { describe, expect, it } from 'vitest';
import { normalizeSVG } from '../src/parse/normalize.ts';
import { reconstructSVG } from '../src/reconstruct.ts';
import { sceneToSVG } from '../src/emit/to-svg.ts';
import { shapeFields, translateShape } from '../src/edit/index.ts';
import type { Shape } from '../src/types.ts';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="20" fill="black"/>
  <text x="10" y="90" font-size="12" font-family="Inter" text-anchor="middle" fill="#333">Logo &amp; Mark</text>
</svg>`;

const textShape = (shapes: Shape[]): Extract<Shape, { kind: 'text' }> => {
  const t = shapes.find((s) => s.kind === 'text');
  if (!t || t.kind !== 'text') throw new Error('no text shape');
  return t;
};

describe('text passthrough', () => {
  it('normalizes <text> without treating it as geometry', () => {
    const doc = normalizeSVG(SVG);
    expect(doc.texts).toHaveLength(1);
    expect(doc.texts![0].text).toBe('Logo & Mark');
    expect(doc.texts![0].fontSize).toBe(12);
    expect(doc.texts![0].anchor).toBe('middle');
    expect(doc.regions).toHaveLength(1); // only the circle
  });

  it('applies group transforms as translation plus uniform scale', () => {
    const doc = normalizeSVG(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(10 20) scale(2)"><text x="5" y="5" font-size="8">hi</text></g></svg>`,
    );
    expect(doc.texts![0].p).toEqual({ x: 20, y: 30 });
    expect(doc.texts![0].fontSize).toBe(16);
  });

  it('concatenates tspans', () => {
    const doc = normalizeSVG(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="0" y="0"><tspan>a</tspan><tspan>b</tspan></text></svg>`,
    );
    expect(doc.texts![0].text).toBe('ab');
  });

  it('survives reconstruct -> emit round trip', () => {
    const scene = reconstructSVG(SVG);
    const t = textShape(scene.shapes);
    expect(t.meta.confidence).toBe(1);
    const out = sceneToSVG(scene);
    expect(out).toContain('<text');
    expect(out).toContain('Logo &amp; Mark');
    expect(out).toContain('text-anchor="middle"');

    // And the emitted SVG parses back to the same text.
    const again = reconstructSVG(out);
    expect(textShape(again.shapes).text).toBe('Logo & Mark');
    expect(textShape(again.shapes).fontSize).toBeCloseTo(12, 6);
  });

  it('is editable: fields and translation', () => {
    const scene = reconstructSVG(SVG);
    const t = textShape(scene.shapes);
    expect(shapeFields(t).map((f) => f.key)).toEqual(['p.x', 'p.y', 'fontSize']);
    const { x, y } = t.p;
    translateShape(t, 3, 4);
    expect(t.p).toEqual({ x: x + 3, y: y + 4 });
  });
});
