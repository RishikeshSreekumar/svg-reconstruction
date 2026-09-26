import type { Constraint, Pt, Shape } from '../types.ts';
import { dist } from '../geom/vec.ts';

interface Circleish {
  id: string;
  c: Pt;
  r: number;
  set: (c: Pt, r: number) => void;
}

function circleish(shapes: Shape[]): Circleish[] {
  const out: Circleish[] = [];
  for (const s of shapes) {
    if (s.kind === 'circle') {
      out.push({
        id: s.id,
        c: s.c,
        r: s.r,
        set: (c, r) => {
          s.c = c;
          s.r = r;
        },
      });
    } else if (s.kind === 'polygon') {
      out.push({
        id: s.id,
        c: s.c,
        r: s.r,
        set: (c, r) => {
          s.c = c;
          s.r = r;
        },
      });
    }
  }
  return out;
}

/**
 * Group values that sit within `tol` of each other. Membership is measured
 * against the running cluster mean, not the previous item — single linkage
 * would let a chain of values, each within `tol` of its neighbour, merge into
 * one group spanning far more than the tolerance and then snap together.
 */
function cluster<T>(items: T[], key: (t: T) => number, tol: number): T[][] {
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const out: T[][] = [];
  let cur: T[] = [];
  let sum = 0;
  for (const it of sorted) {
    if (!cur.length || Math.abs(key(it) - sum / cur.length) <= tol) {
      cur.push(it);
      sum += key(it);
    } else {
      out.push(cur);
      cur = [it];
      sum = key(it);
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((g) => g.length > 1);
}

const meanOf = <T>(group: T[], key: (t: T) => number): number => group.reduce((s, g) => s + key(g), 0) / group.length;

export interface ConstraintResult {
  constraints: Constraint[];
  /** Applied snaps, for the report. */
  notes: string[];
}

/**
 * Detect equal radii, concentricity, axis alignment and symmetry.
 * With `regularize`, near-equal values are snapped to their shared mean — this
 * is what turns "r = 63.98 and r = 64.02" back into "r = 64".
 */
export function detectConstraints(shapes: Shape[], tol: number, regularize: boolean): ConstraintResult {
  const constraints: Constraint[] = [];
  const notes: string[] = [];
  const cs = circleish(shapes);
  const snapTol = tol * 4;

  for (const group of cluster(cs, (c) => c.r, snapTol)) {
    const mean = group.reduce((s, g) => s + g.r, 0) / group.length;
    constraints.push({ kind: 'equal-radius', ids: group.map((g) => g.id), value: mean });
    if (regularize) {
      for (const g of group) g.set(g.c, mean);
      notes.push(`equal-radius: ${group.length} shapes snapped to r=${mean.toFixed(3)}`);
    }
  }

  // Concentric: cluster by centre position directly.
  const used = new Set<string>();
  for (let i = 0; i < cs.length; i++) {
    if (used.has(cs[i].id)) continue;
    const group = [cs[i]];
    for (let j = i + 1; j < cs.length; j++) {
      if (used.has(cs[j].id)) continue;
      if (dist(cs[i].c, cs[j].c) <= snapTol) group.push(cs[j]);
    }
    if (group.length > 1) {
      const c: Pt = {
        x: group.reduce((s, g) => s + g.c.x, 0) / group.length,
        y: group.reduce((s, g) => s + g.c.y, 0) / group.length,
      };
      constraints.push({ kind: 'concentric', ids: group.map((g) => g.id), c });
      if (regularize) {
        for (const g of group) {
          g.set(c, g.r);
          used.add(g.id);
        }
        notes.push(`concentric: ${group.length} shapes snapped to (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
      }
    }
  }

  // Alignment reports the group mean, same as equal-radius — the minimum would
  // put the guide at the edge of the cluster instead of through it.
  for (const group of cluster(cs, (c) => c.c.y, snapTol)) {
    if (group.length > 1) constraints.push({ kind: 'aligned-h', ids: group.map((g) => g.id), y: meanOf(group, (g) => g.c.y) });
  }
  for (const group of cluster(cs, (c) => c.c.x, snapTol)) {
    if (group.length > 1) constraints.push({ kind: 'aligned-v', ids: group.map((g) => g.id), x: meanOf(group, (g) => g.c.x) });
  }

  return { constraints, notes };
}

export interface SymmetryResult {
  /** Vertical mirror axis x = value, if the artwork is left/right symmetric. */
  mirrorX?: number;
  /** Horizontal mirror axis y = value. */
  mirrorY?: number;
  /** Rotational symmetry order about `center`, 2..12. */
  rotational?: { order: number; center: Pt };
}

/**
 * Global symmetry over a point cloud sampled from the artwork.
 * Cheap, and a strong signal — a logo that is mirror-symmetric almost always
 * was constructed that way.
 */
export function detectSymmetry(cloud: Pt[], tol: number): SymmetryResult {
  const out: SymmetryResult = {};
  if (cloud.length < 8) return out;

  const cx = cloud.reduce((s, p) => s + p.x, 0) / cloud.length;
  const cy = cloud.reduce((s, p) => s + p.y, 0) / cloud.length;
  const c = { x: cx, y: cy };

  const matches = (tf: (p: Pt) => Pt): boolean => {
    // Every transformed point must land near some original point.
    for (const p of cloud) {
      const q = tf(p);
      let best = Infinity;
      for (const o of cloud) {
        const d = dist(q, o);
        if (d < best) best = d;
        if (best <= tol) break;
      }
      if (best > tol) return false;
    }
    return true;
  };

  if (matches((p) => ({ x: 2 * cx - p.x, y: p.y }))) out.mirrorX = cx;
  if (matches((p) => ({ x: p.x, y: 2 * cy - p.y }))) out.mirrorY = cy;

  for (let order = 12; order >= 2; order--) {
    const a = (2 * Math.PI) / order;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rot = (p: Pt): Pt => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return { x: cx + cos * dx - sin * dy, y: cy + sin * dx + cos * dy };
    };
    if (matches(rot)) {
      out.rotational = { order, center: c };
      break;
    }
  }
  return out;
}
