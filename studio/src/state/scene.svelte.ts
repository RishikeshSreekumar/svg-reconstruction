import type { EditOptions, Scene, SegRef } from '../../../src/index.ts';
import { inferGuidelines, rebuildConstruction, reconstructSVG } from '../../../src/index.ts';
import { history } from './history.svelte.ts';
import { view } from './view.svelte.ts';

export interface MutateOptions {
  /** Take an undo checkpoint before running. One checkpoint per gesture. */
  commit?: boolean;
  /** Skip the construction re-derivation (pure metadata changes). */
  rebuild?: boolean;
}

/**
 * The one owner of the engine scene. The scene is a plain mutable object the
 * engine edits in place, so it is held as `$state.raw` and every change goes
 * through `mutate`, which bumps `rev` — components derive through `rev` to see
 * fresh geometry. No component may mutate the scene directly.
 */
class SceneStore {
  scene: Scene | null = $state.raw(null);
  rev = $state(0);
  inputSVG = $state('');
  selected: string | null = $state(null);
  selectedSeg: SegRef | null = $state(null);
  warning = $state('');
  /** Transient reassurance line (not a warning) for the status bar. */
  notice = $state('');
  /** True while a reconstruct is running on the main thread. */
  busy = $state(false);
  /** True once the loaded scene has been edited; drives the unload guard. */
  dirty = $state(false);
  enforce = $state(true);

  #noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Show a transient reassurance line in the status bar. */
  flash(text: string): void {
    this.notice = text;
    clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => (this.notice = ''), 6000);
  }

  load(svg: string): void {
    let scene: Scene;
    try {
      scene = reconstructSVG(svg);
    } catch (e) {
      this.warning = `could not read that SVG: ${e instanceof Error ? e.message : e}`;
      return;
    }
    if (!scene.shapes.length && !svg.includes('<svg')) {
      this.warning = 'that did not look like an SVG';
      return;
    }
    // Replacing a scene is a gesture like any other: the outgoing scene goes
    // on the undo stack, so a mis-click on the fixtures select is recoverable.
    const replacedEdits = this.scene !== null && this.dirty;
    if (this.scene) history.checkpoint(this.scene, this.inputSVG);
    else history.reset();
    this.inputSVG = svg;
    scene.guidelines = inferGuidelines(scene);
    this.scene = scene;
    this.selected = null;
    this.selectedSeg = null;
    this.warning = '';
    this.dirty = false;
    if (replacedEdits) this.flash('previous scene kept on the undo stack — Cmd+Z brings it back');
    this.rev++;
  }

  editOpts(): EditOptions {
    return { enforce: this.enforce, maxResidual: this.scene ? this.scene.report.tol * 2 : undefined };
  }

  /** Take an undo checkpoint explicitly (start of a drag gesture). */
  checkpoint(): void {
    if (this.scene) history.checkpoint(this.scene, this.inputSVG);
  }

  mutate(fn: (s: Scene) => void, opts: MutateOptions = {}): void {
    const s = this.scene;
    if (!s) return;
    if (opts.commit) history.checkpoint(s, this.inputSVG);
    fn(s);
    if (opts.rebuild !== false) rebuildConstruction(s);
    this.refreshGuides(s);
    this.dirty = true;
    this.rev++;
  }

  /** Re-derive inferred guides from the current constraints; keep user guides. */
  private refreshGuides(s: Scene): void {
    const user = (s.guidelines ?? []).filter((g) => g.source === 'user');
    s.guidelines = [...inferGuidelines(s), ...user];
  }

  undo(): void {
    if (!this.scene) return;
    const prev = history.undo({ scene: this.scene, inputSVG: this.inputSVG });
    if (!prev) return;
    this.#restore(prev.scene, prev.inputSVG);
  }

  redo(): void {
    if (!this.scene) return;
    const next = history.redo({ scene: this.scene, inputSVG: this.inputSVG });
    if (!next) return;
    this.#restore(next.scene, next.inputSVG);
  }

  /** Adopt a history snapshot; refit the view when it belongs to a different artwork. */
  #restore(scene: Scene, inputSVG: string): void {
    const refit = this.scene && String(this.scene.viewBox) !== String(scene.viewBox);
    this.scene = scene;
    this.inputSVG = inputSVG;
    this.revalidateSelection();
    this.warning = '';
    if (refit) view.fit(scene);
    this.rev++;
  }

  private revalidateSelection(): void {
    const s = this.scene;
    if (!s) return;
    if (this.selected && !s.shapes.some((x) => x.id === this.selected)) this.selected = null;
    const r = this.selectedSeg;
    if (r) {
      const shape = s.shapes.find((x) => x.id === r.shape);
      if (!shape || shape.kind !== 'path' || !shape.contours[r.contour]?.segs[r.seg]) this.selectedSeg = null;
    }
  }

  select(id: string | null, seg: SegRef | null = null): void {
    this.selected = id;
    this.selectedSeg = seg;
  }

  /** Surface a solver verdict the way the legacy `track` helper did. */
  track(res: { applied: boolean; residual?: number; constrained?: boolean }): void {
    if (!res.applied) {
      this.warning =
        res.residual != null
          ? `edit refused: it would tear the contour open by ${res.residual.toFixed(2)} units`
          : 'edit refused';
    } else if (res.constrained) {
      this.warning = 'that value is fixed by the joins either side — change a neighbour, or the radius, instead';
    } else {
      this.warning = '';
    }
  }
}

export const store = new SceneStore();

// Dev console access: inspect the live scene while debugging interactions.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__store = store;
