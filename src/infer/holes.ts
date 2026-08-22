import type { Pt, Region } from '../types.ts';
import { bboxContains, pointInPoly, polyInsidePoly } from '../geom/poly.ts';
import { mid, norm, perp, sub } from '../geom/vec.ts';

export interface NestNode {
  region: Region;
  parent: NestNode | null;
  children: NestNode[];
  depth: number;
  /** True when this contour subtracts from the shape it sits inside. */
  hole: boolean;
}

/** Signed winding number of `p` with respect to a closed polyline. */
export function windingNumber(p: Pt, poly: Pt[]): number {
  let w = 0;
  const n = poly.length;
  for (let i = 1; i < n; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    if (a.y <= p.y) {
      if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) w++;
    } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) {
      w--;
    }
  }
  return w;
}

/** A point just inside the contour, near its first edge. */
function interiorProbe(poly: Pt[]): Pt | null {
  for (let i = 1; i < poly.length; i++) {
    const m = mid(poly[i - 1], poly[i]);
    const d = norm(sub(poly[i], poly[i - 1]));
    if (d.x === 0 && d.y === 0) continue;
    const nrm = perp(d);
    // Step in by a fraction of the edge length, then verify.
    const step = Math.max(1e-9, Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y) * 0.25);
    for (const sgn of [1, -1]) {
      const q = { x: m.x + nrm.x * step * sgn, y: m.y + nrm.y * step * sgn };
      if (pointInPoly(q, poly)) return q;
    }
  }
  return null;
}

/**
 * Build the containment forest and decide which contours are holes.
 *
 * Subtraction is not guessed at: flattened SVG already encodes it via winding
 * (nonzero) or nesting parity (evenodd). Both are evaluated per source element,
 * because fill rules do not reach across elements.
 */
export function buildNesting(regions: Region[]): NestNode[] {
  const closed = regions.filter((r) => r.closed && Math.abs(r.area) > 0);
  const nodes: NestNode[] = closed.map((region) => ({ region, parent: null, children: [], depth: 0, hole: false }));

  const byElem = new Map<number, NestNode[]>();
  for (const n of nodes) {
    const list = byElem.get(n.region.elem) ?? [];
    list.push(n);
    byElem.set(n.region.elem, list);
  }

  for (const group of byElem.values()) {
    // Largest first: a contour's parent is the smallest contour containing it.
    const order = [...group].sort((a, b) => Math.abs(b.region.area) - Math.abs(a.region.area));
    for (let i = 0; i < order.length; i++) {
      const inner = order[i];
      let best: NestNode | null = null;
      for (let j = 0; j < i; j++) {
        const outer = order[j];
        if (!bboxContains(outer.region.bbox, inner.region.bbox, 1e-6)) continue;
        if (!polyInsidePoly(inner.region.poly, outer.region.poly)) continue;
        if (!best || Math.abs(outer.region.area) < Math.abs(best.region.area)) best = outer;
      }
      if (best) {
        inner.parent = best;
        best.children.push(inner);
      }
    }

    for (const n of group) {
      let d = 0;
      let p = n.parent;
      while (p) {
        d++;
        p = p.parent;
      }
      n.depth = d;
    }

    // Evaluate the fill rule at a probe point just inside each contour, summing
    // over every contour of the element. Comparing only against the immediate
    // parent gets nested rings wrong.
    for (const n of group) {
      if (!n.parent) {
        n.hole = false;
        continue;
      }
      const probe = interiorProbe(n.region.poly);
      if (!probe) {
        n.hole = n.depth % 2 === 1;
        continue;
      }
      const rule = n.region.style.fillRule ?? 'nonzero';
      if (rule === 'evenodd') {
        let count = 0;
        for (const m of group) if (pointInPoly(probe, m.region.poly)) count++;
        n.hole = count % 2 === 0;
      } else {
        let w = 0;
        for (const m of group) w += windingNumber(probe, m.region.poly);
        n.hole = w === 0;
      }
    }
  }
  return nodes;
}

/** Roots of the forest, in document order. */
export function rootsOf(nodes: NestNode[]): NestNode[] {
  return nodes.filter((n) => !n.parent);
}
