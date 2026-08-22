---
target: studio
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-22T11-56-17Z
slug: studio-src-app-svelte
---
Method: dual-agent (A: design-review sub-agent · B: detector/browser sub-agent)

Target: studio (`studio/src/App.svelte`, Operate surface). Browser overlay evidence unavailable this run — Claude-in-Chrome extension not connected for either agent; A reviewed full source + could not screenshot, B ran the deterministic detector (degraded regex mode: htmlparser2/css-select/css-tree/domutils missing, so contrast and selector matching unverified — 0 findings on `.svelte` files is an undercount signal, not a clean bill).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Rich status bar, but reconstruction runs synchronously with no busy state; export gives zero feedback |
| 2 | Match System / Real World | 3 | Domain vocabulary exact; raw engine error text and exponential notation assume expert reader |
| 3 | User Control and Freedom | 2 | Fixture load / Paste / Reset / Flatten silently destroy edits AND undo stack (`history.reset()`), no confirm, no `beforeunload` |
| 4 | Consistency and Standards | 3 | Two unreconciled accent blues (`--accent #59a1ff` vs hard-coded `#2f7fe8`); text glyphs ▼▲✕ beside real icon set; PasteModal `.primary` contradicts toolbar `.ibtn.primary` |
| 5 | Error Prevention | 3 | Solver refuses over-determined edits; but nothing guards the destructive-load path; any dropped file read as SVG |
| 6 | Recognition Rather Than Recall | 3 | Shortcut letters in rail; but Alt-bypass/Space-pan live only in tooltips; seg-table columns unlabeled |
| 7 | Flexibility and Efficiency | 2 | No arrow-key nudge, no multi-select, no shift-constrain, no fit-to-view after zoom (fit only on load) |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained instrument-panel look; minor redundancy (conf% + bar, duplicated warning) |
| 9 | Error Recovery | 3 | Best-in-class refusal copy ("would tear the contour open by 2.41 units") but rendered at 11px far from the shape that snapped back |
| 10 | Help and Documentation | 2 | Thorough tooltips; no shortcut cheatsheet, no explanation of confidence % or tolerance |
| **Total** | | **27/40** | **Acceptable (upper band)** |

## Design Specificity Verdict

**LLM assessment:** Unmistakably authored for this product. Flatten button copy ("destroy the construction the way an exporter would"), "{N} in → {M} numbers out" payoff metric, confidence bars, quantified refusal copy, spec-sheet construction marks on canvas (arc circles, centres, radius rays), semantic handle vocabulary (hollow = length, filled = position) — "honest over impressive" made visible. Thin spot: the Constraints section — the flagship — is 11.5px prose strings, not the RS-mark spec panel the success bar names.

**Deterministic scan:** 1 finding. `flat-type-hierarchy` at `studio/index.html:38` — sizes 10/11/11.5/12/13px, ratio 1.3:1. Half-legitimate: compressed range defensible for dense tool UI (h1 differentiates by weight), but 11.5px and 12.5px vs 12px are sub-pixel distinctions carrying no hierarchy. Converges with A's independent findings: two numeric dialects in one panel, 8px rail shortcut letters. Detector ran degraded (regex fallback) — contrast never computed; A manually flagged `--faint #666d79` at 11px below AA and the 13%-alpha focus ring, which the detector could not verify. LLM caught what the degraded detector structurally missed.

**Visual overlays:** none — no reliable user-visible overlay available. Fallback signal: "browser visualization unavailable: Claude-in-Chrome extension not connected" (3 failed attempts, both agents).

## Overall Impression

A genuinely product-specific instrument panel with the best refusal UX either assessment has seen in an editor — undermined by one trust-breaking hole (silent total data loss from a dropdown), an inaccessible canvas, and a flagship Constraints section still rendered as prose. Biggest opportunity: build the actual spec panel; it fixes specificity, working memory, and the showcase bar in one move.

## What's Working

1. **Refusal copy as product identity** (`scene.svelte.ts` `track()`): quantifies the residual in units and suggests the correct alternative ("change a neighbour, or the radius, instead"). "Refuse rather than fake" turned into UX.
2. **Semantic handles + construction marks**: hollow handles set lengths, filled set positions; selection reveals arc construction circles and centre dots. The construction genuinely is the interface.
3. **Honest metrics as ambient UI**: threshold-colored confidence bars, exponential tolerance/max-dev, in→out coordinate counts; edits pass raw floats, display-only rounding.

## Priority Issues

1. **[P0] Silent, unrecoverable data loss on load/Reset/Flatten.** `store.load()` calls `history.reset()`; fixtures dropdown, Paste, Open, Drop, Reset, Flatten all route through it. One mis-click on the fixtures select destroys a session in a tool whose pitch is trust. **Fix:** confirm when `history.canUndo`, or make load an undoable checkpoint (snapshot undo makes it cheap); add `beforeunload` while edits exist. **Command:** /impeccable harden
2. **[P1] Canvas inaccessible; feedback silent to AT.** `role="application"` with no `tabindex`, no keyboard selection/nudge; ParamRow/ShapeCard labels unassociated (lint suppressed); focus ring is 13%-alpha blue — invisible; no `aria-live` for warnings/snap hints; PasteModal lacks `aria-modal`/focus trap; panel resizer pointer-only. **Fix:** `for`/`id` association, solid `--accent` focus-visible, one polite live region, arrow-key nudge, keyboard on separator. **Command:** /impeccable audit → harden
3. **[P1] Refusal/rollback feedback mis-located.** Best copy in the app lands at 11px in the status bar and a warnbox atop a scrollable panel while the user watches a shape rubber-band mid-canvas. Reads as "app is broken." **Fix:** transient in-canvas annotation near the refused handle (reuse existing SVG hint-label channel); status line stays as persistent record. **Command:** /impeccable clarify
4. **[P2] No way back after zoom/pan.** `view.fit()` only on load; zoom% readout inert; reload is the only recovery. **Fix:** clickable zoom% → Fit, `Shift+1`/`0` shortcuts, double-click empty canvas. **Command:** /impeccable polish
5. **[P2] Constraints section undersells the flagship.** Prose strings, no hover→canvas highlight, no grouping, no radii table — while the success bar names "the RS-mark spec panel at full craft." **Fix:** structured rows (kind badge, tabular-nums value, member chips), hover lights up involved shapes on canvas — also fixes the working-memory bridge. **Command:** /impeccable shape (spec panel concept) → layout

## Persona Red Flags

**Alex (Power User):** no arrow-key nudge; no shift-constrain during drag-to-size; no multi-select/marquee; no fit-to-view recovery after wheel zoom; no drag-to-scrub on ParamRow labels, spinners hidden at `opacity: 0` until hover; no shortcut cheatsheet; Alt-bypass-snap only in the Snap toggle tooltip.

**Sam (Screen reader / keyboard):** entire canvas untabbable and inoperable; shapes selectable only via panel cards, handles unreachable; every number/fill/stroke input unlabeled to AT; `:focus-visible` invisible (rgba .13); refusals, snap hints, load errors never announced; ▼▲✕ rely on `title` alone; `--faint` 11px text below AA.

**Riley (Stress tester):** refresh mid-edit = total silent loss; huge paste freezes tab (synchronous `reconstructSVG`, no busy state) and `structuredClone` × 100-deep undo invites memory blowup; drop a PNG before any scene loads → warnbox never renders (`{#if scene}`), only tiny status line; any drag over window flashes full-screen drop overlay; empty-state copy says "toolbar on the left" but the left element is the tool rail.

## Cognitive Load

Failed 3/8: **chunking/≤4-options** (toolbar row 1 = 9 controls, shape tool group = 6, toggle row = 5, all flat); **working-memory bridges** (constraints name shape ids as prose with no hover-link to canvas; unlabeled seg-table columns). Moderate load — address soon. Emotional journey: peak at load ("142 in → 38 numbers out" + compare wipe); valleys at refused drags (feedback mis-located) and destructive load (cliff); end anticlimax — export is fire-and-forget with no round-trip residual, which the product philosophy begs for.

## Minor Observations

- OriginalThumb fixed bottom-left, `pointer-events: none` — cannot dismiss; occludes on short stages.
- Canvas mark palette (`#2f7fe8`, `#ffd166`, `#d29922`) hard-coded in three components outside token system.
- Two numeric dialects: 3-decimal `fmt` vs exponential Report in same panel.
- Section `resize: vertical` native grip nearly invisible on dark UI.
- Escape triple-duty (modal → tool → deselect) — over-eager deselects.
- Fixtures `select` as destructive action trigger — anti-pattern, ties into P0.
- Dark-only theme is a committed decision (`color-scheme: dark`) — fine, worth recording in a DESIGN.md.

## Questions to Consider

1. Export is the proof moment — why does "verify by regenerating" stop at the compare wipe? Re-reconstruct the exported file and print the round-trip residual next to the download; that one number is the whole thesis.
2. Is the current Constraints list believed to be the spec panel, or is the spec panel the deliverable not yet built?
3. Confidence 73% in amber — what should the user do with it? Nothing links it to the residual or offending segment; without an action it is decorative anxiety, not honest signal.
