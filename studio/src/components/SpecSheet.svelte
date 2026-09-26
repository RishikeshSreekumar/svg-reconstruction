<script lang="ts">
  import type { Scene } from '../../../src/types.ts';
  import { buildSpec, type SpecHighlight } from '../lib/spec.ts';
  import { tooltip } from '../lib/tooltip.ts';
  import { store } from '../state/scene.svelte.ts';
  import { view } from '../state/view.svelte.ts';
  import Icon from './Icon.svelte';
  import Section from './Section.svelte';

  let { scene }: { scene: Scene } = $props();

  const spec = $derived((store.rev, buildSpec(scene)));

  const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();

  function show(hl: SpecHighlight | undefined): void {
    view.hoverSpec = hl ?? null;
  }

  // Leaving the sheet (or unmounting it) always clears the canvas overlay.
  $effect(() => () => {
    view.hoverSpec = null;
  });

  function pick(shape: string, seg?: { shape: string; contour: number; seg: number }): void {
    store.select(shape, seg ?? null);
  }

  const HINTS = {
    radii: 'Every distinct radius in the mark, and which shapes and segments share it. Reported as measured, never snapped to a round number.',
    joins: 'How each pair of neighbouring segments meets: tangent, so the curve continues smoothly, or a corner at a measured angle.',
    proportions: 'Ratios the mark is actually built on — ink area, bounding boxes, stroke weights — read off the reconstruction.',
  };

  function iconFor(id: string): string {
    const kind = scene.shapes.find((s) => s.id === id)?.kind ?? 'path';
    return kind === 'path' ? 'path' : kind;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions — mouseleave only clears a hover overlay; rows handle focus/blur themselves -->
<div class="spec" onmouseleave={() => show(undefined)}>
  {#if spec.radii.length}
    <Section title="Radii" count={spec.radii.length} hint={HINTS.radii} fill>
      <div class="colhead radii"><span>label</span><span>value</span><span>used by</span></div>
      <div class="specrows">
        {#each spec.radii as r (r.label)}
          <button
            class="specrow radius"
            onmouseenter={() => show(r.highlight)}
            onfocus={() => show(r.highlight)}
            onblur={() => show(undefined)}
            onclick={() => pick(r.members[0].shape, r.members[0].seg)}
          >
            <span class="rlabel">{r.label}</span>
            <span class="rvalue">{fmt(r.value)}</span>
            <span class="chips">
              {#if r.members.length > 1}<span class="rcount">×{r.members.length}</span>{/if}
              {#each r.members as m (m.text)}
                <span class="chip" use:tooltip={m.seg ? `${scene.shapes.find((s) => s.id === m.shape)?.kind ?? 'path'} segment ${m.seg.seg}` : (scene.shapes.find((s) => s.id === m.shape)?.kind ?? 'shape')}>
                  <Icon name={iconFor(m.shape)} size={11} />
                  {#if m.seg}<span>{m.seg.seg}</span>{/if}
                </span>
              {/each}
            </span>
          </button>
        {/each}
      </div>
    </Section>
  {/if}

  <Section title="Joins" count={spec.joins.length} hint={HINTS.joins} fill>
    {#if spec.joins.length}
      <div class="colhead joins"><span>segments</span><span>continuity</span><span>error</span></div>
      <div class="specrows">
        {#each spec.joins as j, i (i)}
          <button
            class="specrow join"
            onmouseenter={() => show(j.highlight)}
            onfocus={() => show(j.highlight)}
            onblur={() => show(undefined)}
            onclick={() => pick(j.a.shape, j.a)}
          >
            <span class="jpair">
              <span><Icon name={iconFor(j.a.shape)} size={11} /> {j.a.seg}</span>
              <span class="to">→</span>
              <span><Icon name={iconFor(j.b.shape)} size={11} /> {j.b.seg}</span>
            </span>
            <span class="jkind" class:tangent={j.kind === 'tangent'}>{j.kind}{j.solved ? ' · solved' : ''}</span>
            <span class="jvalue">{j.kind === 'tangent' ? `${j.value.toExponential(1)} rad` : `${fmt(j.value)}°`}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="dimnote">no joins detected</div>
    {/if}
  </Section>

  {#if spec.facts.length}
    <Section title="Proportions" count={spec.facts.length} hint={HINTS.proportions} fill>
      <div class="specrows">
        {#each spec.facts as f, i (i)}
          <button
            class="specrow fact"
            class:inert={!f.highlight}
            onmouseenter={() => show(f.highlight)}
            onfocus={() => show(f.highlight)}
            onblur={() => show(undefined)}
          >
            <span class="fname">{f.name}</span>
            <span class="fvalue">{f.value}</span>
            {#if f.detail}<span class="fdetail">{f.detail}</span>{/if}
          </button>
        {/each}
      </div>
    </Section>
  {/if}
</div>

<style>
  /* The sheet is a flex track inside the panel so its open sections can claim
     the height the collapsed ones gave back. */
  .spec {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  /* Column captions: a spec sheet is a table, so name the columns once
     instead of making every row re-explain itself. */
  .colhead {
    display: grid;
    gap: 10px;
    padding: 0 6px 5px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--faint);
    border-bottom: 1px solid var(--line);
  }
  .colhead.radii {
    grid-template-columns: 34px auto 1fr;
  }
  .colhead.joins {
    grid-template-columns: 1fr auto auto;
  }
  .colhead.joins span:last-child,
  .colhead.radii span:last-child {
    text-align: right;
  }

  .specrows {
    display: flex;
    flex-direction: column;
  }
  .specrow {
    display: grid;
    gap: 3px 10px;
    align-items: baseline;
    width: 100%;
    padding: 7px 6px;
    background: none;
    border: none;
    border-radius: 6px;
    border-bottom: 1px solid var(--line);
    box-shadow: none;
    color: var(--dim);
    font: inherit;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: left;
    cursor: pointer;
  }
  .specrow:last-child {
    border-bottom: none;
  }
  .specrow:hover,
  .specrow:focus-visible {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--text);
  }
  .specrow.inert {
    cursor: default;
  }

  .specrow.radius {
    grid-template-columns: 34px auto 1fr;
  }
  .rlabel {
    display: inline-block;
    padding: 1px 0;
    color: var(--primary);
    font-weight: 700;
    font-size: 12px;
  }
  .rvalue {
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
  }
  .rcount {
    color: var(--faint);
    align-self: center;
  }
  /* Third column, so the chips actually sit under the "used by" caption
     instead of wrapping to a line the header never names. */
  .chips {
    grid-column: 3;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 3px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 10px;
    line-height: 1.7;
    color: var(--dim);
    background: var(--panel2);
  }
  .specrow:hover .chip,
  .specrow:focus-visible .chip {
    color: var(--text);
    background: rgba(255, 255, 255, 0.7);
  }

  .specrow.join {
    grid-template-columns: 1fr auto auto;
  }
  .jpair {
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .jpair > span:not(.to) {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .jpair .to {
    color: var(--faint);
    padding: 0 1px;
  }
  .jkind {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--panel2);
    color: var(--dim);
    font-size: 10px;
  }
  /* Tangency is the one join the solver actually proved — colour says so. */
  .jkind.tangent {
    background: var(--secondary-soft);
    color: var(--secondary);
    font-weight: 500;
  }
  .jvalue {
    text-align: right;
    white-space: nowrap;
    min-width: 58px;
  }

  .specrow.fact {
    grid-template-columns: 1fr auto;
  }
  .fname {
    color: var(--faint);
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.5px;
  }
  .fvalue {
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    text-align: right;
  }
  .fdetail {
    grid-column: 1 / -1;
    color: var(--dim);
    line-height: 1.45;
  }
  .dimnote {
    color: var(--dim);
    font-size: 11px;
    padding: 4px 0;
  }
</style>
