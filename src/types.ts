/** Core types: geometry, primitives, scene graph, constraints. */

export interface Pt {
  x: number;
  y: number;
}

/** 2D affine matrix, SVG order: [a c e; b d f; 0 0 1]. */
export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Absolute path command after normalization. Arcs are kept when present. */
export type Cmd =
  | { t: 'M'; p: Pt }
  | { t: 'L'; p: Pt }
  | { t: 'C'; c1: Pt; c2: Pt; p: Pt }
  | { t: 'Q'; c1: Pt; p: Pt }
  | { t: 'A'; rx: number; ry: number; rot: number; large: boolean; sweep: boolean; p: Pt }
  | { t: 'Z' };

/** One continuous run of a path. `closed` mirrors an explicit Z. */
export interface SubPath {
  cmds: Cmd[];
  closed: boolean;
}

export interface Style {
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  fillRule?: 'nonzero' | 'evenodd';
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  opacity?: number;
}

/** A flattened source region: one subpath, sampled to a polyline. */
export interface Region {
  id: string;
  /**
   * Index of the source path element. Fill rules and hole nesting apply within
   * one element only — subpaths of different elements paint independently.
   */
  elem: number;
  sub: SubPath;
  /** Adaptive polyline sample of `sub`, in user space. First point == last when closed. */
  poly: Pt[];
  closed: boolean;
  style: Style;
  /** Signed area of `poly`; sign gives winding direction. */
  area: number;
  bbox: BBox;
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ---------------------------------------------------------------------------
// Fitted primitives
// ---------------------------------------------------------------------------

export type PrimKind = 'line' | 'arc' | 'circle' | 'ellipse' | 'cubic';

export interface FitBase {
  kind: PrimKind;
  /** Max deviation of source samples from the fitted primitive, in user units. */
  maxDev: number;
  rmsDev: number;
  /** Number of free scalar parameters — feeds the MDL score. */
  params: number;
}

export interface LineFit extends FitBase {
  kind: 'line';
  a: Pt;
  b: Pt;
}

export interface ArcFit extends FitBase {
  kind: 'arc';
  c: Pt;
  r: number;
  /** Radians, in SVG screen space (y down). */
  a0: number;
  a1: number;
  ccw: boolean;
  a: Pt;
  b: Pt;
}

export interface CircleFit extends FitBase {
  kind: 'circle';
  c: Pt;
  r: number;
}

export interface EllipseFit extends FitBase {
  kind: 'ellipse';
  c: Pt;
  rx: number;
  ry: number;
  /** Radians. */
  rot: number;
}

export interface CubicFit extends FitBase {
  kind: 'cubic';
  /**
   * Raw fallback: the original samples, unmodelled — or, when `c1`/`c2` are
   * present, a sampling of the true bezier they define with pts[0] and
   * pts[pts.length-1] as its endpoints.
   */
  pts: Pt[];
  /** First bezier control point. Present only on authored curves. */
  c1?: Pt;
  /** Second bezier control point. Present only on authored curves. */
  c2?: Pt;
}

export type Fit = LineFit | ArcFit | CircleFit | EllipseFit | CubicFit;

// ---------------------------------------------------------------------------
// Scene graph — the authoritative editable output
// ---------------------------------------------------------------------------

export interface ShapeBase {
  id: string;
  style: Style;
  meta: ShapeMeta;
  /** Closed geometry subtracted from this shape by the editor. */
  cutouts?: Cutout[];
}

/**
 * Geometry captured by a boolean subtract operation. Cutouts deliberately do
 * not carry paint: subtract uses the closed outline, as vector editors do.
 */
export type Cutout =
  | { kind: 'circle'; c: Pt; r: number }
  | { kind: 'ellipse'; c: Pt; rx: number; ry: number; rot: number }
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      rx: number;
      /** Radians; 0 for axis-aligned. */
      rot: number;
    }
  | { kind: 'polygon'; pts: Pt[] }
  | { kind: 'path'; contours: Contour[]; fillRule?: 'nonzero' | 'evenodd' };

export type Shape = ShapeBase & (
  | { kind: 'circle'; c: Pt; r: number }
  | { kind: 'ellipse'; c: Pt; rx: number; ry: number; rot: number }
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      rx: number;
      /** Radians; 0 for axis-aligned. */
      rot: number;
    }
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'polygon'; pts: Pt[]; sides: number; c: Pt; r: number; rot: number }
  /** A contour built from fitted segments — the general case. */
  | { kind: 'path'; contours: Contour[] }
  /**
   * Text carried through as-is: it is never fitted from outlines, only parsed
   * from a `<text>` element or placed by the editor. `p` is the anchor point.
   */
  | {
      kind: 'text';
      p: Pt;
      text: string;
      fontSize: number;
      fontFamily: string;
      anchor: 'start' | 'middle' | 'end';
    }
);

export interface Contour {
  segs: Fit[];
  closed: boolean;
  /** True when this contour is a hole subtracted from the shape it sits inside. */
  hole: boolean;
}

export interface ShapeMeta {
  /** 0..1. Derived from fit error relative to tolerance and from verification. */
  confidence: number;
  maxDev: number;
  /** Human-readable derivation, e.g. "annulus -> stroked circle". */
  note?: string;
  /** Ids of source regions this shape came from. */
  from: string[];
}

/** Address of one fitted segment inside a shape's contour. */
export interface SegRef {
  shape: string;
  contour: number;
  seg: number;
}

export type Constraint =
  | { kind: 'equal-radius'; ids: string[]; value: number }
  | { kind: 'concentric'; ids: string[]; c: Pt }
  | { kind: 'aligned-h'; ids: string[]; y: number }
  | { kind: 'aligned-v'; ids: string[]; x: number }
  | { kind: 'reflection'; axis: { p: Pt; dir: Pt }; ids: string[] }
  | { kind: 'rotational'; order: number; c: Pt; ids: string[] }
  | { kind: 'concentric-with'; ids: string[]; c: Pt }
  /**
   * Tangent continuity across a join between two adjacent segments.
   * `solved` marks the arc-to-line case: a line tangent to a circle is a value
   * you have to solve for, where two tangent arcs only need collinear centres.
   */
  | { kind: 'tangent'; a: SegRef; b: SegRef; residual: number; solved: boolean }
  /** A kink: the join is not tangent, and the exterior angle is `angle` radians. */
  | { kind: 'corner'; a: SegRef; b: SegRef; angle: number }
  /** Arc segments sharing a radius. Detected only — snapping would break the chain. */
  | { kind: 'equal-radius-seg'; segs: SegRef[]; value: number }
  | { kind: 'semicircle'; seg: SegRef; sweep: number }
  /** Ink bbox proportion, and whether the ink touches all four viewBox edges. */
  | { kind: 'aspect'; ratio: number; tight: boolean };

/**
 * A construction guide: an infinite line (or a point) the artwork is built
 * around. Inferred ones are re-derived from the constraints after every
 * structural change; user ones are authored in the editor and never touched.
 * Guides live beside `constraints`, not inside them, so `rebuildConstruction`
 * cannot drop them.
 */
export type Guideline = {
  id: string;
  source: 'inferred' | 'user';
  role: 'align' | 'mirror' | 'tangent' | 'center' | 'bbox';
  label?: string;
  /** Shape ids this guide was derived from. */
  from?: string[];
} & (
  | { kind: 'h'; y: number }
  | { kind: 'v'; x: number }
  | { kind: 'angled'; p: Pt; dir: Pt }
  /** A construction point — drawn as a cross-hair. */
  | { kind: 'point'; p: Pt }
);

/** One row of the construction listing: what defines a segment, and how it joins. */
export interface SegNote {
  ref: SegRef;
  kind: PrimKind;
  /** The defining value, e.g. `v x=7.50 len=81.00` or `r 4.000 sweep 90.0deg cw`. */
  value: string;
  /** Continuity with the neighbouring segments, e.g. `G1 both ends`. */
  relation: string;
  /** Radius, for arcs — the thing a construction table lists. */
  r?: number;
  /** Signed sweep in radians, for arcs. */
  sweep?: number;
}

/** Segment-level construction of the artwork: the "fixed values" view. */
export interface Construction {
  segs: SegNote[];
  /** Bbox of the painted ink, stroke width included. */
  ink: BBox;
  /** ink width / ink height. */
  aspect: number;
  /** True when the ink touches all four viewBox edges. */
  tightViewBox: boolean;
  /** Distinct stroke widths in use, each as a fraction of the ink height. */
  strokes: { width: number; ofHeight: number; cap: string; join: string }[];
}

export interface Scene {
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  shapes: Shape[];
  constraints: Constraint[];
  /** Construction guides — inferred from the constraints, plus user-authored. */
  guidelines?: Guideline[];
  /** Segment-level construction, when `detectConstruction` is on. */
  construction?: Construction;
  /** Per-run diagnostics for the UI and the bench. */
  report: Report;
}

export interface Report {
  /** Tolerance actually used, in user units. */
  tol: number;
  sourceRegions: number;
  /** Count by output shape kind. */
  kinds: Record<string, number>;
  /** Max deviation across every emitted shape. */
  maxDev: number;
  /** Fraction of source samples explained by a non-`cubic` primitive. */
  primitiveCoverage: number;
  notes: string[];
}

export interface Options {
  /**
   * Deviation tolerance as a fraction of the diagonal of the artwork bbox.
   * Deviation is gated on MAX (Hausdorff), never mean.
   */
  relTol?: number;
  /** Absolute floor for tolerance, user units. */
  absTol?: number;
  /** Try to recover expanded strokes back into stroked centerlines. */
  detectStrokes?: boolean;
  /** Detect symmetry and near-equal radii, and snap them. */
  detectConstraints?: boolean;
  /** Analyse per-segment construction: radii, sweeps, tangency, corners. */
  detectConstruction?: boolean;
  /**
   * Move nearly-tangent joins onto the exact tangent point, so a solved
   * construction reads back as solved. Verified against the source and dropped
   * if it drifts.
   */
  snapTangents?: boolean;
  /**
   * Angular tolerance for calling a join tangent, in radians. A real solved
   * tangency lands within ~1e-3; a designer's kink is tens of degrees, so the
   * gap between the two is wide and this value is not delicate.
   */
  g1Tol?: number;
  /** Snap near-equal radii / centers to their shared value. */
  regularize?: boolean;
  /** MDL weight on primitive count. */
  lambdaPrims?: number;
  /** MDL weight on parameter count. */
  lambdaParams?: number;
}

export const DEFAULTS: Required<Options> = {
  relTol: 0.0015,
  absTol: 1e-4,
  detectStrokes: true,
  detectConstraints: true,
  detectConstruction: true,
  snapTangents: true,
  g1Tol: 0.02,
  regularize: true,
  lambdaPrims: 1.0,
  lambdaParams: 0.25,
};
