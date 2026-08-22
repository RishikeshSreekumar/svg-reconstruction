# svg-reconstruction

Recover editable primitives, strokes and constraints from flattened SVG path soup.

```
1516 numbers of cubic-bezier path data
  ->  3 stroked circles + 1 rounded rect + equal-radius + concentric constraints
  ->  29 numbers
```

Zero runtime dependencies. The engine is plain TypeScript: its own path parser,
its own fitting, its own offsetting.

## Scope

This does **not** recover "the original construction" — flattening destroys
intent and that information is gone. It produces the *simplest reconstruction
consistent with the pixels*, reports how far off it is, and says so when more
than one reading fits.

**Handles today**

- lines, circular arcs, circles, ellipses, rects, rounded rects, rotated rects,
  regular polygons
- expanded strokes recovered back to centerline + `stroke-width` + cap + join,
  both open (a stroked line) and closed (a ring, a stroked polygon)
- holes, read from winding or `fill-rule` — not guessed at
- nested group transforms, non-uniform scale, compound paths
- equal-radius, concentric, axis alignment, mirror and rotational symmetry,
  with optional snapping to the shared value
- segment-level construction inside a path: each arc's radius and sweep, every
  join classified tangent or corner, half-turns, shared radii, the ink's own
  proportion and stroke width as a fraction of it

**Explicitly out of scope for now**

- boolean unions whose seams were erased (see *Known limits*)
- lettering and outlined fonts, gradients, masks, clip paths
- organic/hand-drawn artwork — kept as paths rather than forced into primitives

## Use

```bash
npm install

npm test          # 91 unit + corpus tests
npm run bench     # accuracy table over fixtures/
npm run dev       # the studio, interactive UI at localhost:5173
```

CLI:

```bash
npx tsx bin/svgrec.ts flat.svg -o clean.svg --annotate
npx tsx bin/svgrec.ts logo.svg --flatten -o flat.svg   # forward model
```

Library:

```ts
import { reconstructSVG, sceneToSVG, sceneToText } from './src/index.ts';

const scene = reconstructSVG(svgString, { relTol: 0.0015 });
console.log(sceneToText(scene));   // construction listing + confidence
const clean = sceneToSVG(scene);   // real <circle>/<rect>/<path> elements
```

`scene` is the authoritative JSON scene graph: shapes with parameters,
constraints, per-shape confidence, `construction`, and a report. SVG is
generated from it.

## The construction listing

A lettermark is often one stroked centerline of lines and arcs, and "13 segments"
says nothing about it. `scene.construction` reads the interior of a path — what
defines each segment, and how it meets its neighbours:

```
s0  Path     7 line, 6 arc stroke=15.00 butt/round  [96%]
         seg  kind    value                                relation
         0    line    v x=7.50 len=81.00                   start, G1 out
         1    arc     r 4.000 sweep 90.0deg cw             G1 both ends
         3    arc     r 13.000 sweep 142.4deg cw           G1 both ends
         9    arc     r 15.744 sweep 179.9deg ccw          G1 both ends
         11   arc     r 9.501 sweep 180.0deg cw            G1 both ends

Constraints:
  tangent(s0.2 -> s0.3) residual 1.1e-16 rad  [solved: line tangent to arc]
  aspect 1.2175:1   ink bbox == viewBox
  semicircle(s0.9, s0.11)

Stroke:
  w=15.00 = 15.0% of ink height, butt/round
```

Two things make this honest rather than decorative:

**Tangency is repaired before it is reported.** A tangent join has no curvature
discontinuity, so the split between an arc and the line leaving it lands a few
samples off and each piece is fitted over slightly the wrong run — a true
half-turn comes back at 171 degrees and the chain reads as a string of
3-degree kinks that the artwork does not have. Nearly-tangent joins are moved
onto the exact tangent point, and near-straight arcs are straightened, both
gated on the same verification as everything else.

**Segment radii are reported, never snapped.** A segment shares its endpoints
with the segments either side, so forcing two radii equal during reconstruction
tears the chain. Whole-shape radii still snap; segment radii are stated with
their measured values and an `equal-radius-seg` constraint noting they agree —
and `src/edit/` will move a whole group of them on request, because an edit can
re-solve the chain where the fitter cannot.

Ink proportions come from the painted outline, not from growing the geometry
bbox by half a stroke width: a butt cap paints nothing past its endpoint, and
the shortcut would claim a viewBox was tight when the mark never reaches it.

## Editing the geometry, not the path data

The scene graph is the thing you edit. Every value in the construction listing
is an input: an arc's radius and centre, a line's length and angle, the point
two segments share. Change one and the chain re-solves around it — the `d`
attribute is regenerated, never hand-edited.

```ts
import { editSegmentParam, rebuildConstruction, segmentFields } from './src/index.ts';

segmentFields(arc);                   // [r, cx, cy, sweep] — what this segment is
editSegmentParam(scene, { shape: 's0', contour: 0, seg: 1 }, 'r', 30, {
  enforce: true,                      // move the whole equal-radius group
  maxResidual: scene.report.tol,      // refuse edits that tear the contour open
});
rebuildConstruction(scene);           // the listing now reads back r 30.000
```

The solver is local and holds the character of each join:

- **A radius change is a fillet.** Tangent straight neighbours keep their
  direction and their far ends; the arc's centre moves and the straights are
  re-trimmed. A vertical stem stays vertical and just gets shorter — it does not
  pivot to chase the arc.
- **Parallel sides are a rounded end.** With no fillet centre to solve for, the
  two sides slide apart along their normals instead, which is what widening the
  end of a stroked bar means.
- **Tangent stays tangent, a corner stays a corner.** Joins are classified from
  the geometry before the edit, then re-established after it. On the fixtures a
  tangent join comes back within 1e-6 rad and the chain within 1e-9 units.
- **Over-determined loops say so.** A closed chain of tangent arcs cannot honour
  an arbitrary new radius; past `maxResidual` the edit is rolled back rather
  than left tearing the outline. A value the joins pin — the sweep of an arc
  between two tangent lines — comes back flagged `constrained` instead of
  silently ignored.

The studio puts this on the canvas: drag a centre, a radius or a join and the
construction table updates live; type into any field for the same effect.

Whole-shape constraints preserve only the degrees of freedom they describe.
An equal-radius group can still be positioned independently; a horizontal row
shares `y` while every member keeps its own `x`; moving one member of a mirror
or rotational orbit moves its counterpart. A shape on a symmetry axis moves
the axis and construction together, so it is not pinned in place. Centre drags
apply `x` and `y` atomically, and contour edits are rolled back as one operation
if any linked segment would tear. Gold canvas guides show equal radii,
alignment, concentric centres, mirror axes and rotational spokes.

## How it works

```
flattened SVG
  -> normalize      transforms baked in, absolute commands, subpaths split,
                    adaptive curve sampling, densified so straight runs carry
                    interior samples
  -> nest           containment forest per source element; holes read from
                    winding number (nonzero) or nesting parity (evenodd)
  -> strokes        constant-thickness detection -> centerline -> re-expand and
                    verify against the source outline
  -> fit            corner split -> recursive split-and-merge -> Taubin circle,
                    total-least-squares line, algebraic-conic ellipse
  -> recognize      whole-contour shapes, each verified by regenerating it and
                    comparing with Hausdorff
  -> repair         nearly-tangent joins moved onto the exact tangent point,
                    near-straight arcs straightened; verified, else discarded
  -> constrain      equal radii, concentricity, alignment, symmetry; snap
  -> construct      per-segment radii and sweeps, tangency vs corners,
                    half-turns, ink proportion, stroke as % of ink height
  -> emit           real SVG primitive elements
```

Two decisions carry most of the quality:

**Max deviation, never mean.** Every accept/reject is gated on Hausdorff
distance. Mean error hides a single bad spike, which is exactly the failure a
designer notices.

**Verify by regenerating.** A fit that succeeded numerically can still be
visually wrong. Every named shape, every recovered stroke and every tangency
repair is re-rendered and compared against the source before it is accepted.
That check is also the safety net: enforcing tangency on a real corner moves the
geometry far off the artwork, so the repair is thrown away.

Tolerance is relative to the artwork diagonal (`relTol`, default 0.0015), so
results do not change with viewBox scale.

## The benchmark

The point of `fixtures/` is that ground truth is free: each fixture is authored
with real primitives and strokes, `flattenSVG()` destroys that, and the
reconstructor is scored on how much it gets back. Metrics are `relHausdorff`
(rendered-vs-rendered, as a fraction of the diagonal) and primitive F1.

```
fixture                   relHaus    F1  F1@p1       coords
01-circle                  9.8e-5  100%   100%      261->15
02-ring                    1.3e-4  100%   100%      513->17
...
20-offcenter-ellipses      4.3e-4  100%   100%      538->30
21-tangent-skeleton        1.4e-3  100%   100%      479->44
MEAN                       3.8e-4  100%   100%
```

`F1@p1` re-runs the whole corpus with coordinates rounded to one decimal. Real
path soup is quantized, and a fitter tuned on clean numbers lies about its own
accuracy.

Run `npm run bench` for the current table; artifacts land in `.bench-out/`.

## Known limits

- **Erased boolean seams.** Two overlapping circles merged into one outline lose
  the seam. Recovering `A ∪ B` needs hypothesis search over tangent
  discontinuities. Not implemented — subtraction *is* handled, because the
  source already encodes it.
- **Genuine ambiguity.** A pill is exactly a fully-rounded rect and exactly a
  round-capped stroked line. No algorithm can separate them. Where both fit, the
  simpler one wins and the report records `ambiguous — also fits <kind>`.
- **No general constraint solver.** `src/edit/` re-solves a contour locally —
  join by join, outwards from the segment you changed — and propagates the
  detected shape-level relations. It is not a global numeric solver: it cannot
  satisfy a closed loop of tangent arcs at once, which is exactly the case it
  refuses rather than fakes. `planegcs` is the obvious drop-in if that becomes
  the priority.
- **Arc-to-arc tangency is reported, not repaired.** Making two arcs tangent
  needs their centres exactly `r1 ± r2` apart, so it means moving a centre —
  a solve across the chain rather than a local fix. Line-to-arc joins, which is
  what a tangent-solved construction is mostly made of, are repaired.
- **Self-intersecting offsets.** Stroke expansion is used for verification and
  for the forward model. It joins correctly but does not clip self-overlap on
  deep concavities, so very tight corners at large widths degrade.
- **One fill per shape.** Gradients, patterns and opacity groups pass through as
  flat attributes.

## Layout

```
src/geom/      vectors, matrices, beziers, arcs, polylines, offsetting, linalg
src/parse/     XML reader, path-data parser, normalizer
src/fit/       primitive fitting, segmentation, tangency repair, recognition
src/infer/     holes, strokes, constraints, symmetry, construction
src/edit/      chain solver: edit a construction value, re-solve the contour
src/emit/      scene graph -> SVG / text
src/bench/     forward model, metrics, runner
studio/        the editing app: overlay, confidence, drag handles, live editing
```
