export * from './types.ts';
export { reconstructSVG, reconstructDoc } from './reconstruct.ts';
export { normalizeSVG, docBBox, shapeToCmds, type Doc } from './parse/normalize.ts';
export { parsePathData, splitSubPaths, transformCmds, flattenSubPath, cmdsToD } from './parse/path.ts';
export { sceneToSVG, sceneToText, shapeToElement, contourToD } from './emit/to-svg.ts';
export { segmentPolyline, detectCorners, fitRun, mdlCost } from './fit/segment.ts';
export { fitLine, fitArc, fitCircle, fitEllipse, taubinCircle, refineCircle, sampleFit } from './fit/primitives.ts';
export { recognizeClosed, tryRect, tryRegularPolygon, type ShapeGuess } from './fit/shapes.ts';
export { detectSelfStroke, detectAnnulusStroke, type StrokeCandidate } from './infer/stroke.ts';
export { buildNesting, rootsOf, type NestNode } from './infer/holes.ts';
export { detectConstraints, detectSymmetry } from './infer/constraints.ts';
export { analyzeConstruction, inkBBox, type ConstructionResult } from './infer/construction.ts';
export {
  editShapeParam,
  editShapeParams,
  editSegmentParam,
  moveJoin,
  moveSegmentCenter,
  rebuildConstruction,
  shapeAnchor,
  translateShape,
  shapeFields,
  segmentFields,
  refreshPolygon,
  captureJoins,
  solveContour,
  type Field,
  type EditOptions,
  type SegEditResult,
  type ShapeEditResult,
  type JoinSpec,
  type JoinIntent,
} from './edit/index.ts';
export { inferGuidelines } from './infer/guidelines.ts';
export {
  createShape,
  deleteShape,
  translateShapeInScene,
  reorderShape,
  nextUserId,
  nextUserGuideId,
  type CreatableKind,
  type CreateOptions,
} from './edit/create.ts';
export { segStart, segEnd, segTangent, segPt, arcPt, reangle, syncArcEnds, arcDir, angleOfPt } from './geom/seg.ts';
export { expandStroke, offsetSide, type Cap, type Join } from './geom/offset.ts';
export { hausdorff, directedHausdorff, resample, signedArea, bboxOf, bboxDiag } from './geom/poly.ts';
export { flattenSVG } from './bench/flatten.ts';
export { compare, groundTruth, cloudOf, countCoords, type CompareResult } from './bench/compare.ts';
