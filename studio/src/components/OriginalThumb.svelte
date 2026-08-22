<script lang="ts">
  import { countCoords } from '../../../src/index.ts';
  import { store } from '../state/scene.svelte.ts';
  import { fitToStage } from '../lib/svg-load.ts';
  import Icon from './Icon.svelte';

  const html = $derived(store.inputSVG ? fitToStage(store.inputSVG) : '');
  const stat = $derived(store.inputSVG ? countCoords(store.inputSVG) : 0);

  let open = $state(true);
</script>

{#if html}
  <aside class="thumb">
    <button class="head" onclick={() => (open = !open)} title={open ? 'Hide the original' : 'Show the original'} aria-expanded={open}>
      <Icon name="eye" size={12} />
      <span class="label">Original</span>
      <span class="stat">{stat} numbers</span>
    </button>
    {#if open}
      <div class="art" title="The input path soup, untouched">{@html html}</div>
    {/if}
  </aside>
{/if}

<style>
  .thumb {
    position: absolute;
    right: 14px;
    top: 14px;
    width: 146px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: var(--shadow);
    z-index: 3;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    background: var(--panel);
    border: none;
    border-radius: 0;
    box-shadow: none;
    color: var(--dim);
    font-size: 10px;
    text-align: left;
  }
  .head:hover {
    color: var(--text);
    background: var(--panel2);
    border-color: transparent;
  }
  .label {
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 600;
  }
  .stat {
    margin-left: auto;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .art {
    background: #fff;
    border-top: 1px solid var(--line);
    height: 104px;
    display: grid;
    place-items: center;
    padding: 8px;
    pointer-events: none;
  }
  .art :global(svg) {
    max-width: 100%;
    max-height: 100%;
  }
</style>
