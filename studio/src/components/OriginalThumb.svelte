<script lang="ts">
  import { store } from '../state/scene.svelte.ts';
  import { tooltip } from '../lib/tooltip.ts';
  import Icon from './Icon.svelte';

  // Rendered through an <img> data URI, never {@html}: the input is arbitrary
  // dropped markup, and an image element cannot run its scripts.
  const href = $derived(store.inputSVG ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(store.inputSVG)}` : '');

  let open = $state(true);
</script>

{#if href}
  <aside class="thumb">
    <button class="head" onclick={() => (open = !open)} use:tooltip={open ? 'Hide the original' : 'Show the original'} aria-expanded={open}>
      <Icon name="eye" size={12} />
      <span class="label">Original</span>
    </button>
    {#if open}
      <div class="art"><img src={href} alt="Original SVG input" /></div>
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
  .art {
    background: #fff;
    border-top: 1px solid var(--line);
    height: 104px;
    display: grid;
    place-items: center;
    padding: 8px;
    pointer-events: none;
  }
  .art img {
    max-width: 100%;
    max-height: 100%;
  }
</style>
