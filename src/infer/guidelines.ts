import type { Fit, Guideline, Scene, SegRef } from '../types.ts';

/**
 * Derive drawable construction guides from the constraints a reconstruction
 * already carries. No new detection happens here — an alignment is a line, a
 * mirror axis is a line, a solved tangency is a line, a shared centre is a
 * point; this module only gives them geometry a canvas can draw and a cursor
 * can snap to.
 *
 * Ids are `g0…` and regenerated on every call. User guides (`ug…`) are
 * authored elsewhere and must be preserved by the caller, not by this pass.
 */
export function inferGuidelines(scene: Scene): Guideline[] {
  const tol = Math.max(scene.report.tol * 2, 1e-9);
  const out: Guideline[] = [];
  // Omit distributes badly over the Guideline union, so drafts are typed as the
  // union itself and get their real id after the dedupe pass.
  type Draft = Guideline extends infer G ? (G extends Guideline ? Omit<G, 'id' | 'source'> : never) : never;
  const push = (g: Draft): void => {
    out.push({ ...g, id: '', source: 'inferred' } as Guideline);
  };

  for (const c of scene.constraints) {
    switch (c.kind) {
      case 'aligned-h':
        push({ kind: 'h', y: c.y, role: 'align', from: c.ids });
        break;
      case 'aligned-v':
        push({ kind: 'v', x: c.x, role: 'align', from: c.ids });
        break;
      case 'reflection': {
        // dir is the direction of the axis itself.
        if (Math.abs(c.axis.dir.x) < 1e-9) push({ kind: 'v', x: c.axis.p.x, role: 'mirror', label: 'mirror', from: c.ids });
        else if (Math.abs(c.axis.dir.y) < 1e-9) push({ kind: 'h', y: c.axis.p.y, role: 'mirror', label: 'mirror', from: c.ids });
        else {
          const d = unit(c.axis.dir);
          if (d) push({ kind: 'angled', p: { ...c.axis.p }, dir: d, role: 'mirror', label: 'mirror', from: c.ids });
        }
        break;
      }
      case 'concentric':
      case 'concentric-with':
        push({ kind: 'point', p: { ...c.c }, role: 'center', from: c.ids });
        break;
      case 'rotational':
        push({ kind: 'point', p: { ...c.c }, role: 'center', label: `order ${c.order}`, from: c.ids });
        break;
      case 'tangent': {
        if (!c.solved) break;
        // The solved case is line-tangent-to-arc: the line side carries the
        // tangent line a spec sheet would draw.
        const f = lineFitOf(scene, c.a) ?? lineFitOf(scene, c.b);
        if (!f) break;
        const d = unit({ x: f.b.x - f.a.x, y: f.b.y - f.a.y });
        if (!d) break;
        push({ kind: 'angled', p: { ...f.a }, dir: d, role: 'tangent', label: 'tangent', from: [c.a.shape, c.b.shape] });
        break;
      }
    }
  }

  const ink = scene.construction?.ink;
  if (ink) {
    push({ kind: 'h', y: ink.y0, role: 'bbox', label: 'ink top' });
    push({ kind: 'h', y: ink.y1, role: 'bbox', label: 'ink bottom' });
    push({ kind: 'v', x: ink.x0, role: 'bbox', label: 'ink left' });
    push({ kind: 'v', x: ink.x1, role: 'bbox', label: 'ink right' });
  }

  const merged = dedupe(out, tol);
  merged.forEach((g, i) => (g.id = `g${i}`));
  return merged;
}

const ROLE_RANK: Record<Guideline['role'], number> = { mirror: 0, align: 1, tangent: 2, center: 3, bbox: 4 };

/** Collapse coincident guides, keeping the most meaningful role and the union of provenance. */
function dedupe(gs: Guideline[], tol: number): Guideline[] {
  const out: Guideline[] = [];
  const angTol = 1e-3;
  for (const g of gs.slice().sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role])) {
    const twin = out.find((o) => {
      if (o.kind !== g.kind) return false;
      if (o.kind === 'h' && g.kind === 'h') return Math.abs(o.y - g.y) <= tol;
      if (o.kind === 'v' && g.kind === 'v') return Math.abs(o.x - g.x) <= tol;
      if (o.kind === 'point' && g.kind === 'point') return Math.hypot(o.p.x - g.p.x, o.p.y - g.p.y) <= tol;
      if (o.kind === 'angled' && g.kind === 'angled') {
        const da = angleDiff(angleOf(o.dir), angleOf(g.dir));
        return da <= angTol && Math.abs(offsetOf(o) - offsetOf(g)) <= tol;
      }
      return false;
    });
    if (twin) {
      if (g.from) twin.from = [...new Set([...(twin.from ?? []), ...g.from])];
      continue;
    }
    out.push(g);
  }
  return out;
}

const angleOf = (d: { x: number; y: number }): number => {
  // Undirected: an axis pointing up equals one pointing down.
  const a = Math.atan2(d.y, d.x);
  return ((a % Math.PI) + Math.PI) % Math.PI;
};

const angleDiff = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Math.min(d, Math.PI - d);
};

/** Signed distance of the origin from an angled guide's line. */
function offsetOf(g: Extract<Guideline, { kind: 'angled' }>): number {
  const n = { x: -g.dir.y, y: g.dir.x };
  return g.p.x * n.x + g.p.y * n.y;
}

function unit(d: { x: number; y: number }): { x: number; y: number } | null {
  const l = Math.hypot(d.x, d.y);
  return l > 1e-12 ? { x: d.x / l, y: d.y / l } : null;
}

function lineFitOf(scene: Scene, ref: SegRef): Extract<Fit, { kind: 'line' }> | null {
  const s = scene.shapes.find((x) => x.id === ref.shape);
  if (!s || s.kind !== 'path') return null;
  const f = s.contours[ref.contour]?.segs[ref.seg];
  return f && f.kind === 'line' ? f : null;
}
