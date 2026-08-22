<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    title,
    count = null,
    open = true,
    resizable = false,
    children,
  }: {
    title: string;
    count?: number | null;
    open?: boolean;
    /** Give the body a drag-to-resize height (native CSS resize). */
    resizable?: boolean;
    children: Snippet;
  } = $props();

  // svelte-ignore state_referenced_locally — `open` is only the initial value by design
  let isOpen = $state(open);
</script>

<section class="psec">
  <button class="sechead" aria-expanded={isOpen} onclick={() => (isOpen = !isOpen)}>
    <span class="chev" class:open={isOpen}><Icon name="chevron" size={11} /></span>
    <span class="title">{title}</span>
    {#if count != null}<span class="count">{count}</span>{/if}
  </button>
  {#if isOpen}
    <div class="secbody" class:resizable>
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .psec {
    border-bottom: 1px solid var(--line);
  }
  .psec:last-child {
    border-bottom: none;
  }
  .sechead {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    background: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
    padding: 11px 2px;
    color: var(--dim);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    cursor: pointer;
    text-align: left;
  }
  .sechead:hover {
    color: var(--text);
    background: none;
    border-color: transparent;
  }
  .chev {
    display: grid;
    place-items: center;
    transition: transform 0.12s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .title {
    flex: 1;
  }
  .count {
    font-variant-numeric: tabular-nums;
    background: var(--panel2);
    border-radius: 9px;
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    color: var(--dim);
  }
  .secbody {
    padding: 0 2px 12px;
  }
  .secbody.resizable {
    resize: vertical;
    overflow: auto;
    min-height: 60px;
    height: 260px;
  }
</style>
