import type { Pt } from '../../../src/types.ts';

/** Pointer event position in the svg's user units. */
export function userPt(ev: { clientX: number; clientY: number }, svg: SVGSVGElement | null): Pt | null {
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm) return null;
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** One screen pixel in user units — hit radii have to be in screen terms. */
export function pxScale(svg: SVGSVGElement | null): number {
  const ctm = svg?.getScreenCTM();
  return ctm ? 1 / Math.hypot(ctm.a, ctm.b) : 1;
}
