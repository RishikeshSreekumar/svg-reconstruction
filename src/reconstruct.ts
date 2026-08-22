import type { Contour, Fit, Options, Pt, Region, Report, Scene, Shape, Style } from './types.ts';
import { DEFAULTS } from './types.ts';
import { docBBox, normalizeSVG, type Doc } from './parse/normalize.ts';
import { bboxDiag, resample, totalLength } from './geom/poly.ts';
import { segmentPolyline } from './fit/segment.ts';
import { snapTangencies } from './fit/tangency.ts';
import { recognizeClosed, type ShapeGuess } from './fit/shapes.ts';
import { sampleFit } from './fit/primitives.ts';
import { buildNesting, type NestNode } from './infer/holes.ts';
import { detectAnnulusStroke, detectSelfStroke, type StrokeCandidate } from './infer/stroke.ts';
import { detectConstraints, detectSymmetry } from './infer/constraints.ts';
import { analyzeConstruction, inkBBox } from './infer/construction.ts';

let uid = 0;
const nextId = (p: string): string => `${p}${uid++}`;

export function reconstructSVG(src: string, opts: Options = {}): Scene {
  return reconstructDoc(normalizeSVG(src), opts);
}

/**
 * Merge options over the defaults, ignoring explicit `undefined`.
 * A plain spread would let `{relTol: undefined}` from an unset CLI flag wipe
 * out the default and turn every tolerance into NaN.
 */
function withDefaults(opts: Options): Required<Options> {
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) (o as Record<string, unknown>)[k] = v;
  }
  return o;
}

export function reconstructDoc(doc: Doc, opts: Options = {}): Scene {
  const o = withDefaults(opts);
  uid = 0;

  const bb = docBBox(doc);
  const diag = bboxDiag(bb) || Math.hypot(doc.viewBox[2], doc.viewBox[3]) || 1;
  const tol = Math.max(diag * o.relTol, o.absTol);

  const notes: string[] = [];
  const shapes: Shape[] = [];
  const consumed = new Set<string>();

  const nodes = buildNesting(doc.regions);
  const byId = new Map<string, NestNode>(nodes.map((n) => [n.region.id, n]));
  const fitCache = new Map<string, RegionFit>();

  // --- 1. Stroke recovery ------------------------------------------------
  // Runs first: a recovered stroke replaces two contours (or one) with a
  // single centerline, which is both simpler and closer to the real source.
  if (o.detectStrokes) {
    for (const n of nodes) {
      if (consumed.has(n.region.id)) continue;
      const holes = n.children.filter((c) => c.hole && !consumed.has(c.region.id));
      if (holes.length !== 1 || holes[0].children.length) continue;
      const cand = detectAnnulusStroke(n.region.poly, holes[0].region.poly, tol);
      if (!cand) continue;
      shapes.push(strokeToShape(cand, n.region, tol, [n.region.id, holes[0].region.id], o));
      consumed.add(n.region.id);
      consumed.add(holes[0].region.id);
      notes.push(`${n.region.id}+${holes[0].region.id}: ${cand.note} (w=${cand.width.toFixed(3)})`);
    }
    for (const n of nodes) {
      if (consumed.has(n.region.id) || n.hole || n.children.length) continue;
      const cand = detectSelfStroke(n.region.poly, tol);
      if (!cand) continue;

      // A filled outline that reads as a stroke may also be an exact primitive
      // (a pill is both). Take the primitive only when it fits clearly better;
      // otherwise keep the stroke, which carries fewer parameters.
      const alt = fitCached(n.region, tol, o, fitCache);
      if (alt.guess && alt.guess.maxDev + tol < cand.maxDev) {
        notes.push(`${n.region.id}: stroke rejected, ${alt.guess.kind} fits better`);
        continue;
      }
      if (alt.guess) {
        notes.push(`${n.region.id}: ambiguous — also fits ${alt.guess.kind}`);
      }
      shapes.push(strokeToShape(cand, n.region, tol, [n.region.id], o));
      consumed.add(n.region.id);
      notes.push(`${n.region.id}: ${cand.note} (w=${cand.width.toFixed(3)})`);
    }
  }

  // --- 2. Fit everything else -------------------------------------------
  let explained = 0;
  let totalLen = 0;

  for (const region of doc.regions) {
    if (consumed.has(region.id)) continue;
    const node = byId.get(region.id);
    if (node?.hole) continue; // emitted with its parent

    const holeNodes = (node?.children ?? []).filter((c) => c.hole && !consumed.has(c.region.id));
    const own = fitCached(region, tol, o, fitCache);
    totalLen += own.len;
    explained += own.explained;

    if (!holeNodes.length && own.guess) {
      shapes.push(guessToShape(own.guess, region.style, tol, [region.id]));
      continue;
    }

    const contours: Contour[] = [{ segs: own.fits, closed: region.closed, hole: false }];
    let maxDev = own.maxDev;
    const from = [region.id];
    for (const h of holeNodes) {
      const hf = fitCached(h.region, tol, o, fitCache);
      totalLen += hf.len;
      explained += hf.explained;
      contours.push({ segs: hf.fits, closed: h.region.closed, hole: true });
      maxDev = Math.max(maxDev, hf.maxDev);
      from.push(h.region.id);
      consumed.add(h.region.id);
    }
    shapes.push({
      kind: 'path',
      id: nextId('s'),
      contours,
      style: region.style,
      meta: { confidence: confOf(maxDev, tol, own.fits), maxDev, from, note: holeNodes.length ? 'with holes' : undefined },
    });
  }

  // Text is a passthrough, not a fit — it joins the scene as-is so the editor
  // can move and restyle it, and it never counts against primitive coverage.
  for (const t of doc.texts ?? []) {
    shapes.push({
      kind: 'text',
      id: nextId('s'),
      p: t.p,
      text: t.text,
      fontSize: t.fontSize,
      fontFamily: t.fontFamily,
      anchor: t.anchor,
      style: t.style,
      meta: { confidence: 1, maxDev: 0, from: [], note: t.note ?? 'text passthrough' },
    });
  }

  // --- 3. Global relationships ------------------------------------------
  let constraints: Scene['constraints'] = [];
  if (o.detectConstraints) {
    const res = detectConstraints(shapes, tol, o.regularize);
    constraints = res.constraints;
    notes.push(...res.notes);

    // 60 samples per closed contour, with the duplicated closing point dropped.
    // The count must divide by the symmetry orders being tested, or a perfectly
    // symmetric shape samples asymmetrically and the test fails.
    const cloud: Pt[] = [];
    for (const r of doc.regions) {
      const n = r.closed ? 61 : 60;
      const s = resample(r.poly, n);
      for (const p of r.closed ? s.slice(0, -1) : s) cloud.push(p);
    }
    const sym = detectSymmetry(cloud, tol * 6);
    if (sym.mirrorX != null) {
      constraints.push({ kind: 'reflection', axis: { p: { x: sym.mirrorX, y: 0 }, dir: { x: 0, y: 1 } }, ids: shapes.map((s) => s.id) });
      notes.push(`reflection symmetry about x=${sym.mirrorX.toFixed(2)}`);
    }
    if (sym.mirrorY != null) {
      constraints.push({ kind: 'reflection', axis: { p: { x: 0, y: sym.mirrorY }, dir: { x: 1, y: 0 } }, ids: shapes.map((s) => s.id) });
      notes.push(`reflection symmetry about y=${sym.mirrorY.toFixed(2)}`);
    }
    if (sym.rotational) {
      constraints.push({ kind: 'rotational', order: sym.rotational.order, c: sym.rotational.center, ids: shapes.map((s) => s.id) });
      notes.push(`rotational symmetry order ${sym.rotational.order}`);
    }
  }

  // --- 4. Segment-level construction ------------------------------------
  // Runs last: it reads the emitted shapes, so any snapping from step 3 is
  // already baked in and the radii it reports are the ones a caller will edit.
  let construction: Scene['construction'];
  if (o.detectConstruction) {
    const res = analyzeConstruction(shapes, inkBBox(doc.regions, bb), doc.viewBox, tol, o.g1Tol);
    construction = res.construction;
    constraints = [...constraints, ...res.constraints];
    notes.push(...res.notes);
  }

  const kinds: Record<string, number> = {};
  let worst = 0;
  for (const s of shapes) {
    kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
    worst = Math.max(worst, s.meta.maxDev);
  }

  const report: Report = {
    tol,
    sourceRegions: doc.regions.length,
    kinds,
    maxDev: worst,
    primitiveCoverage: totalLen > 0 ? explained / totalLen : 1,
    notes,
  };

  return { width: doc.width, height: doc.height, viewBox: doc.viewBox, shapes, constraints, construction, report };
}

// ---------------------------------------------------------------------------

interface RegionFit {
  fits: Fit[];
  guess: ShapeGuess | null;
  maxDev: number;
  len: number;
  explained: number;
}

function fitCached(region: Region, tol: number, o: Required<Options>, cache: Map<string, RegionFit>): RegionFit {
  const hit = cache.get(region.id);
  if (hit) return hit;
  const res = fitRegion(region, tol, o);
  cache.set(region.id, res);
  return res;
}

function fitRegion(region: Region, tol: number, o: Required<Options>): RegionFit {
  let fits = segmentPolyline(region.poly, region.closed, {
    tol,
    lambdaPrims: o.lambdaPrims,
    lambdaParams: o.lambdaParams,
  });
  if (o.snapTangents) fits = snapTangencies(fits, region.poly, region.closed, tol, o.g1Tol);
  const guess = region.closed ? recognizeClosed(region.poly, fits, tol) : null;

  const len = totalLength(region.poly);
  let explained = 0;
  for (const f of fits) {
    if (f.kind === 'cubic') continue;
    explained += totalLength(sampleFit(f, 32));
  }
  if (guess) explained = len;

  const maxDev = guess ? guess.maxDev : fits.reduce((m, f) => Math.max(m, f.maxDev), 0);
  return { fits, guess, maxDev, len, explained: Math.min(explained, len) };
}

function confOf(maxDev: number, tol: number, fits: Fit[]): number {
  const raw = Math.max(0, 1 - maxDev / (tol * 2));
  const fallbacks = fits.filter((f) => f.kind === 'cubic').length;
  const penalty = fits.length ? fallbacks / fits.length : 0;
  return Math.max(0, Math.min(1, raw * (1 - 0.6 * penalty)));
}

function guessToShape(g: ShapeGuess, style: Style, tol: number, from: string[]): Shape {
  const meta = { confidence: Math.max(0, Math.min(1, 1 - g.maxDev / (tol * 2))), maxDev: g.maxDev, from };
  switch (g.kind) {
    case 'circle':
      return { kind: 'circle', id: nextId('s'), c: g.c, r: g.r, style, meta };
    case 'ellipse':
      return { kind: 'ellipse', id: nextId('s'), c: g.c, rx: g.rx, ry: g.ry, rot: g.rot, style, meta };
    case 'rect':
      return { kind: 'rect', id: nextId('s'), x: g.x, y: g.y, w: g.w, h: g.h, rx: g.rx, rot: g.rot, style, meta };
    case 'polygon':
      return { kind: 'polygon', id: nextId('s'), pts: g.pts, sides: g.sides, c: g.c, r: g.r, rot: g.rot, style, meta };
  }
}

/** Turn a recovered stroke into a shape whose geometry is the centerline. */
function strokeToShape(
  cand: StrokeCandidate,
  region: Region,
  tol: number,
  from: string[],
  o: Required<Options>,
): Shape {
  const style: Style = {
    fill: null,
    stroke: region.style.fill ?? region.style.stroke ?? 'black',
    strokeWidth: cand.width,
    strokeLinecap: cand.cap,
    strokeLinejoin: cand.join,
  };
  const meta = {
    confidence: Math.max(0, Math.min(1, 1 - cand.maxDev / (tol * 4))),
    maxDev: cand.maxDev,
    from,
    note: cand.note,
  };

  let fits = segmentPolyline(cand.centerline, cand.closed, { tol: tol * 2, lambdaPrims: 1, lambdaParams: 0.25 });
  if (o.snapTangents) fits = snapTangencies(fits, cand.centerline, cand.closed, tol * 2, o.g1Tol);
  if (cand.closed) {
    const guess = recognizeClosed(cand.centerline, fits, tol * 2);
    if (guess) {
      const s = guessToShape(guess, style, tol * 2, from);
      s.meta.note = cand.note;
      s.meta.maxDev = cand.maxDev;
      return s;
    }
  } else if (fits.length === 1 && fits[0].kind === 'line') {
    return { kind: 'line', id: nextId('s'), a: fits[0].a, b: fits[0].b, style, meta };
  }

  return {
    kind: 'path',
    id: nextId('s'),
    contours: [{ segs: fits, closed: cand.closed, hole: false }],
    style,
    meta,
  };
}
