import type { Scene } from '../../../src/types.ts';

const CAP = 100;

/** One undo step: the scene plus the source SVG it was reconstructed from. */
export interface Snapshot {
  scene: Scene;
  inputSVG: string;
}

/**
 * Snapshot-based undo. Engine edits are not invertible in practice — a segment
 * edit re-solves whole contours and a constrained edit fans out — so history
 * stores clones of the scene, one per committed gesture. Loading a new scene
 * is itself a checkpoint, so a mis-click on the fixtures select is undoable.
 */
class History {
  #undo: Snapshot[] = [];
  #redo: Snapshot[] = [];
  canUndo = $state(false);
  canRedo = $state(false);

  #sync(): void {
    this.canUndo = this.#undo.length > 0;
    this.canRedo = this.#redo.length > 0;
  }

  reset(): void {
    this.#undo = [];
    this.#redo = [];
    this.#sync();
  }

  /** Push the pre-edit state. Call once per gesture, before mutating. */
  checkpoint(scene: Scene, inputSVG: string): void {
    this.#undo.push({ scene: structuredClone(scene), inputSVG });
    if (this.#undo.length > CAP) this.#undo.shift();
    this.#redo = [];
    this.#sync();
  }

  undo(current: Snapshot): Snapshot | null {
    const prev = this.#undo.pop();
    if (!prev) return null;
    this.#redo.push({ scene: structuredClone(current.scene), inputSVG: current.inputSVG });
    this.#sync();
    return prev;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.#redo.pop();
    if (!next) return null;
    this.#undo.push({ scene: structuredClone(current.scene), inputSVG: current.inputSVG });
    this.#sync();
    return next;
  }
}

export const history = new History();
