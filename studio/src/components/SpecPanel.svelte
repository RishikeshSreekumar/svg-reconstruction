<script lang="ts">
  import type { Guideline, Shape } from '../../../src/types.ts';
  import { store } from '../state/scene.svelte.ts';
  import { tooltip } from '../lib/tooltip.ts';
  import { view } from '../state/view.svelte.ts';
  import Icon from './Icon.svelte';
  import ShapeCard from './ShapeCard.svelte';
  import Section from './Section.svelte';
  import SpecSheet from './SpecSheet.svelte';

  // Shallow clones per rev — the engine mutates in place, and unchanged
  // references would make Svelte skip the update entirely.
  const scene = $derived.by(() => {
    store.rev;
    return store.scene ? { ...store.scene } : null;
  });
  const shapes = $derived.by(() => {
    store.rev;
    // The scene stores paint order back-to-front. A layers panel reads
    // front-to-back, so moving a shape forward must also move it upward here.
    return (store.scene?.shapes ?? []).map((s) => ({ ...s }) as Shape).reverse();
  });
  const guides = $derived.by(() => {
    store.rev;
    return (store.scene?.guidelines ?? []).map((g) => ({ ...g }) as Guideline);
  });

  const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();

  const coverage = $derived(scene ? scene.report.primitiveCoverage : 0);
  const covColor = $derived(coverage >= 0.85 ? 'var(--good)' : coverage >= 0.6 ? 'var(--warn)' : 'var(--bad)');

  const HINTS = {
    construction: 'The shapes recovered from the flattened file, front to back. Edit a value and the path data is rebuilt from it — never the other way round.',
    guidelines: 'Construction lines the geometry was measured against: axes of symmetry, shared centres, edges things align to. Press G, J or K to add your own.',
    report: 'How faithful this reconstruction is — what went in, what came out, and how far the result strays from the source outline.',
    notes: 'What the reconstruction inferred or refused to decide — stroke recoveries, symmetries it found, and outlines that more than one primitive would explain.',
  };

  const ROLE_HINTS: Record<string, string> = {
    align: 'shapes line up on this line',
    mirror: 'axis of reflection symmetry',
    tangent: 'a curve touches this line',
    center: 'shared centre',
    bbox: 'edge of the ink bounding box',
  };

  const PANELS: { id: 'edit' | 'spec'; label: string; icon: string }[] = [
    { id: 'edit', label: 'Edit', icon: 'layers' },
    { id: 'spec', label: 'Spec', icon: 'ruler' },
  ];

  function setMode(mode: 'edit' | 'spec'): void {
    view.panelMode = mode;
    view.hoverSpec = null;
  }

  function describeGuide(g: Guideline): string {
    return g.kind === 'h'
      ? `y = ${fmt(g.y)}`
      : g.kind === 'v'
        ? `x = ${fmt(g.x)}`
        : g.kind === 'point'
          ? `${fmt(g.p.x)}, ${fmt(g.p.y)}`
          : `${fmt((Math.atan2(g.dir.y, g.dir.x) * 180) / Math.PI)}° · through ${fmt(g.p.x)}, ${fmt(g.p.y)}`;
  }

  function removeGuide(id: string): void {
    store.mutate(
      (s) => {
        s.guidelines = (s.guidelines ?? []).filter((g) => g.id !== id);
      },
      { commit: true, rebuild: false },
    );
  }
</script>

<aside class="side">
  <!-- Outside the scene gate: a failed first load must still be visible here.
       Hidden while a segment editor is open — the refusal shows inline there instead. -->
  {#if store.warning && !store.selectedSeg}<div class="warnbox" role="status">{store.warning}</div>{/if}
  {#if scene}
    <div class="ptabs" role="group" aria-label="Panel mode">
      {#each PANELS as p (p.id)}
        <button class="ptab" class:on={view.panelMode === p.id} aria-pressed={view.panelMode === p.id} onclick={() => setMode(p.id)}>
          <Icon name={p.icon} size={13} />
          {p.label}
        </button>
      {/each}
    </div>

    {#if view.panelMode === 'edit'}
      <Section title="Construction" count={shapes.length} hint={HINTS.construction} fill>
        {#each shapes as s (s.id)}
          <ShapeCard {s} />
        {:else}
          <div class="dimnote">no shapes — draw one with the toolbox on the left</div>
        {/each}
      </Section>

      <Section title="Guidelines" count={guides.length} hint={HINTS.guidelines} fill>
        <ul class="cons">
          {#each guides as g (g.id)}
            <li class="guide">
              <span class="gtag" class:user={g.source === 'user'} use:tooltip={g.source === 'user' ? 'You drew this guide' : (ROLE_HINTS[g.role] ?? g.role)}>
                {g.source === 'user' ? 'user' : g.role}
              </span>
              <span class="gname">{g.label ?? ''}</span>
              <span class="gpos">{describeGuide(g)}</span>
              {#if g.source === 'user'}
                <button class="mini danger" use:tooltip={'Delete guideline'} aria-label="Delete guideline" onclick={() => removeGuide(g.id)}
                  ><Icon name="x" size={11} /></button
                >
              {/if}
            </li>
          {:else}
            <li class="dimnote">none — use G, J, or K to add a horizontal, vertical, or sloped guide</li>
          {/each}
        </ul>
      </Section>
    {:else}
      <SpecSheet {scene} />
    {/if}

    <Section title="Report" hint={HINTS.report}>
      <div class="metrics">
        <div class="metric" use:tooltip={'Filled regions parsed out of the source file.'}>
          <span class="mlabel">Regions in</span>
          <span class="mval">{scene.report.sourceRegions}</span>
        </div>
        <div class="metric" use:tooltip={'Primitives the reconstruction emitted in their place.'}>
          <span class="mlabel">Shapes out</span>
          <span class="mval">{shapes.length}</span>
        </div>
        <div class="metric" use:tooltip={"Deviation budget in user units, scaled from the artwork's diagonal. Nothing is accepted above it."}>
          <span class="mlabel">Tolerance</span>
          <span class="mval sm">{scene.report.tol.toExponential(2)}</span>
        </div>
        <div class="metric" use:tooltip={'Largest gap between any reconstructed outline and the source outline. Measured worst-case, never averaged.'}>
          <span class="mlabel">Max deviation</span>
          <span class="mval sm">{scene.report.maxDev.toExponential(2)}</span>
        </div>
      </div>
      <div class="cov">
        <div class="covhead">
          <span>Primitive coverage</span>
          <b style:color={covColor}>{(coverage * 100).toFixed(1)}%</b>
        </div>
        <div class="bar"><i style:width="{coverage * 100}%" style:background={covColor}></i></div>
        <p class="covnote">Share of the outline explained by real primitives — lines, arcs, circles — rather than left as freehand curves.</p>
      </div>
    </Section>

    {#if scene.report.notes.length}
      <Section title="Notes" count={scene.report.notes.length} hint={HINTS.notes} open={false}>
        <ul class="cons">
          {#each scene.report.notes as n}
            <li class="note-li"><Icon name="info" size={12} /><span>{n}</span></li>
          {/each}
        </ul>
      </Section>
    {/if}
  {:else}
    <div class="emptyside">no scene yet</div>
  {/if}
</aside>

<style>
  .ptabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
    flex: 0 0 auto;
    margin: 10px 0 4px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel);
  }
  .ptab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 5px 0;
    background: none;
    border: none;
    border-radius: 7px;
    box-shadow: none;
    color: var(--dim);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    cursor: pointer;
  }
  .ptab:hover {
    color: var(--text);
    background: var(--panel2);
    border-color: transparent;
  }
  .ptab.on {
    color: var(--primary);
    background: var(--bg);
    box-shadow: var(--shadow-sm);
  }
  .warnbox {
    flex: 0 0 auto;
    color: var(--warn);
    background: var(--accent-soft);
    font-size: 11px;
    line-height: 1.45;
    padding: 7px 9px;
    margin: 10px 0 0;
    border: 1px solid var(--accent-line);
    border-radius: 8px;
  }

  li.guide {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 8px;
  }
  .gtag {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--panel2);
    color: var(--dim);
    cursor: help;
  }
  .gtag.user {
    background: var(--primary-soft);
    color: var(--primary);
  }
  .gname {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gpos {
    color: var(--dim);
    white-space: nowrap;
  }

  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .metric {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 7px 9px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: help;
  }
  .mlabel {
    font-size: 10px;
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .mval {
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .mval.sm {
    font-size: 12px;
    font-weight: 500;
  }
  .cov {
    margin-top: 10px;
  }
  .covhead {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 11px;
    color: var(--dim);
    margin-bottom: 5px;
  }
  .covhead b {
    font-variant-numeric: tabular-nums;
    font-size: 12px;
  }
  .covnote {
    margin: 7px 0 0;
    color: var(--faint);
    font-size: 11px;
    line-height: 1.45;
    text-wrap: pretty;
  }

  .note-li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 7px;
    align-items: start;
  }
  .note-li :global(svg) {
    margin-top: 2px;
    color: var(--faint);
  }
  .dimnote {
    color: var(--dim);
    font-size: 11px;
    padding: 6px 0;
    border-bottom: none;
  }
  .emptyside {
    color: var(--dim);
    padding: 24px;
    text-align: center;
    font-size: 12px;
  }
</style>
