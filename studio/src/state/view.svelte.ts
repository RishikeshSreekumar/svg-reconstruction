import type { Scene } from '../../../src/types.ts';
import type { SpecHighlight } from '../lib/spec.ts';

/**
 * Viewing state — none of it is document semantics, so none of it lives on the
 * Scene: it does not export, and undo must not step through it.
 */
class ViewStore {
  /** Compare mode: only while enabled, hovering wipes between original (right) and reconstruction (left). */
  compare = $state(false);
  /** Wipe position, percent of the board width revealed as reconstruction. */
  comparePos = $state(100);
  /** Width of the spec panel in px; user-resizable. */
  panelW = $state(340);
  showGrid = $state(true);
  showGuides = $state(true);
  snap = $state(true);
  /** Zoom factor over the fitted view; 1 = artwork fits the stage. */
  zoom = $state(1);
  /** View centre in user units; NaN until first fit. */
  cx = $state(NaN);
  cy = $state(NaN);
  /** Name of the guide the cursor snapped to, for the status bar. */
  snapHint = $state('');
  /** Canvas position of the last refused handle edit — anchors the in-canvas warning. */
  warnAt: { x: number; y: number } | null = $state(null);
  /** Side panel mode: shape cards for editing, or the construction spec sheet. */
  panelMode: 'edit' | 'spec' = $state('edit');
  /** Construction geometry the hovered/focused spec row asks the canvas to draw. */
  hoverSpec: SpecHighlight | null = $state(null);

  fit(scene: Scene): void {
    const vb = scene.viewBox;
    this.zoom = 1;
    this.cx = vb[0] + vb[2] / 2;
    this.cy = vb[1] + vb[3] / 2;
  }

  /** The viewBox the stage should render, honouring zoom and pan. Pure — safe to call from deriveds. */
  viewBoxOf(scene: Scene): [number, number, number, number] {
    const vb = scene.viewBox;
    const cx = Number.isFinite(this.cx) ? this.cx : vb[0] + vb[2] / 2;
    const cy = Number.isFinite(this.cy) ? this.cy : vb[1] + vb[3] / 2;
    const w = vb[2] / this.zoom;
    const h = vb[3] / this.zoom;
    return [cx - w / 2, cy - h / 2, w, h];
  }

  zoomAt(scene: Scene, factor: number, at?: { x: number; y: number }): void {
    const next = Math.min(64, Math.max(0.2, this.zoom * factor));
    if (at && Number.isFinite(this.cx)) {
      // Keep the point under the cursor fixed while the scale changes.
      const k = this.zoom / next;
      this.cx = at.x + (this.cx - at.x) * k;
      this.cy = at.y + (this.cy - at.y) * k;
    }
    this.zoom = next;
  }
}

export const view = new ViewStore();
