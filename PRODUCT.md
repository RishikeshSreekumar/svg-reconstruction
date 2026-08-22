# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two products, one engine (confirmed 2026-08-22):

- Developers who consume the engine — `reconstructSVG()` as an npm library or `svgrec` on the CLI — to recover editable primitives, strokes and constraints from flattened SVG path soup.
- Designers and evaluators who use the **studio** (`studio/`), a standalone product in its own right: an interactive editor for reconstructed geometry, no longer a demo of the library.

## Product Purpose

Recover the *simplest reconstruction consistent with the pixels* from flattened SVG: primitives, centerline strokes, holes, whole-shape constraints, and per-segment construction (radii, sweeps, tangent vs corner joins, ink proportions). Report accuracy honestly and flag ambiguity rather than guessing.

Success (next few months, confirmed): a showcase-quality bar — the studio as one impeccable experience (the RS-mark spec panel: radii table, tangent-solved joins, ink proportions) built at full craft. Not yet chasing hosted-tool traffic or npm adoption metrics.

## Positioning

Honesty is the mechanism a neighbour could not truthfully copy:

- Never claims to recover "the original construction" — flattening destroys intent; it produces the simplest reconstruction consistent with the pixels and says when more than one reading fits (`ambiguous — also fits <kind>`).
- Every accept/reject gated on max deviation (Hausdorff), never mean; every fit verified by regenerating and comparing against the source.
- Tangency repaired before reported; segment radii reported, never snapped.
- Ground truth is free and exact: fixtures are authored editable SVGs flattened by the project's own forward model, so the benchmark scores real recovery.

## Operating Context

- Input: flattened SVG exported from design tools — baked transforms, expanded strokes, compound paths, quantized coordinates.
- Consumption paths: TypeScript library import, `svgrec` CLI, the studio — an interactive Svelte 5 app (`npm run dev`, localhost:5173).
- The scene graph JSON is authoritative; SVG is generated from it. Editing targets inferred geometry, never path data — a value edit re-solves the contour and regenerates `d`.
- Benchmark ritual: `npm run bench` over `fixtures/`, metrics relHausdorff + primitive F1 (+ F1@p1 with coordinates quantized to one decimal).

## Capabilities and Constraints

- Handles: lines/arcs/circles/ellipses/rects/rounded/rotated rects/regular polygons; open and closed expanded strokes back to centerline + width + cap/join; holes from winding or fill-rule; nested group transforms and non-uniform scale; equal-radius, concentric, alignment, mirror and rotational symmetry with optional snapping; segment-level construction.
- Out of scope (deliberate, recorded): erased boolean-union seams, lettering/outlined fonts, gradients/masks/clips, organic artwork (kept as paths).
- Zero runtime dependencies — own parser, fitting, offsetting. This is a commitment, not an accident.
- Local chain solver only, no global constraint solver; over-determined edits are rolled back, not faked. `planegcs` noted as the drop-in if global solving becomes priority.
- Tolerance relative to artwork diagonal (`relTol`, default 0.0015) — scale-invariant results.
- Studio: Svelte 5; all scene mutations via `store.mutate`, rev-counter reactivity, `u`/`ug` id namespaces.
- Prioritization (confirmed): ship the de-flattener first; the constraint editor has no downstream consumer yet.

## Brand Commitments

- "RS" is the author's personal monogram, used as the canonical hard test case and the target of the showcase spec panel. No product brand beyond the name `svg-reconstruction`; no committed voice, palette or identity assets yet.
- Voice in existing copy (README) is technical, plain-spoken, and candid about limits — future surfaces should not oversell past what the engine verifies.

## Evidence on Hand

- 21 authored fixtures in `fixtures/` with free exact ground truth via the forward model (`--flatten`).
- Benchmark table: mean relHausdorff 3.8e-4, 100% primitive F1 across corpus; artifacts in `.bench-out/`.
- 91 unit + corpus tests (`npm test`).
- Real compression demonstrations, e.g. 1516 path numbers → 29 parameters; construction listings with solved tangency residuals (~1e-16 rad).
- No testimonials, users, or press — do not fabricate any.

## Product Principles

1. **Honest over impressive.** Report measured values, residuals and ambiguity; never snap, round or claim beyond what verification supports.
2. **The construction is the interface.** Radii, sweeps, joins and proportions are the user-facing truth; path data is an output format.
3. **Verify by regenerating.** Nothing ships into the scene graph without re-rendering and comparing against the source.
4. **Refuse rather than fake.** Over-determined edits roll back; ambiguous fits are labelled; out-of-scope artwork stays as paths.
5. **Showcase depth, not breadth.** One surface at full craft (RS-mark spec panel) beats many shallow ones.
