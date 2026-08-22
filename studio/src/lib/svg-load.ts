import { flattenSVG } from '../../../src/index.ts';
import { store } from '../state/scene.svelte.ts';
import { view } from '../state/view.svelte.ts';

/** Bundled fixtures. These are authored *editable*, so they are flattened first — the flatten step is what makes the round trip real. */
export const samples = import.meta.glob('../../../fixtures/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export const sampleNames = Object.keys(samples).sort();
export const sampleLabel = (key: string): string => key.split('/').pop()!.replace(/\.svg$/, '');

/**
 * Load policy: pasted / opened / dropped SVGs go straight to the
 * reconstructor — real-world input is already flattened, and an editable one
 * normalizes fine (its `<text>` would be destroyed by flattening). Fixtures
 * take the explicit flatten to demonstrate the round trip.
 */
export async function loadSVG(svg: string, opts: { flatten?: boolean } = {}): Promise<void> {
  // Reconstruction runs synchronously on the main thread; flip the busy flag
  // and let it paint (two frames) so big inputs freeze with a visible reason.
  store.busy = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const input = opts.flatten ? flattenSVG(svg) : svg;
    store.load(input);
  } finally {
    store.busy = false;
  }
  if (store.scene) {
    view.fit(store.scene);
    view.comparePos = 100;
  }
}

export function loadSample(key: string): void {
  void loadSVG(samples[key], { flatten: true });
}

/** Strip a fixed width/height so the stage can size the artwork. */
export function fitToStage(svg: string): string {
  return svg.replace(/^([^>]*<svg\b[^>]*)>/, (_m, head: string) => `${head.replace(/\s(width|height)="[^"]*"/g, '')} width="100%" height="100%">`);
}

export const looksLikeSVG = (text: string): boolean => /<svg[\s>]/i.test(text);
