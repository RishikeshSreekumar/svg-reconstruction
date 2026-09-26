<script lang="ts" module>
  let uid = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    title,
    count = null,
    open = true,
    fill = false,
    hint = null,
    children,
  }: {
    title: string;
    count?: number | null;
    open?: boolean;
    /** Claim the panel's leftover height and scroll internally. */
    fill?: boolean;
    /** One line saying what this section is, shown while it is open. */
    hint?: string | null;
    children: Snippet;
  } = $props();

  const bodyId = `sec-${++uid}`;

  // svelte-ignore state_referenced_locally — `open` is only the initial value by design
  let isOpen = $state(open);
</script>

<section class="psec" class:fill={fill && isOpen}>
  <button class="sechead" aria-expanded={isOpen} aria-controls={bodyId} onclick={() => (isOpen = !isOpen)}>
    <span class="chev" class:open={isOpen}><Icon name="chevron" size={11} /></span>
    <span class="title">{title}</span>
    {#if count != null}<span class="count">{count}</span>{/if}
  </button>
  {#if isOpen}
    <div class="secbody" id={bodyId}>
      <!-- The hint sits outside the scroller: what a section means must not
           scroll away the moment its list is longer than the panel. -->
      {#if hint}<p class="sechint">{hint}</p>{/if}
      <div class="secscroll">
        {@render children()}
      </div>
    </div>
  {/if}
</section>

<style>
  .psec {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    min-height: 0;
    border-bottom: 1px solid var(--line);
  }
  .psec:last-child {
    border-bottom: none;
  }
  /* An open section that owns a list takes whatever height the collapsed
     ones left behind, rather than a fixed guess with dead space under it. */
  .psec.fill {
    flex: 1 1 auto;
    min-height: 108px;
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
    flex: none;
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
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 0 2px 12px;
  }
  .psec.fill .secbody {
    flex: 1 1 auto;
  }
  .sechint {
    flex: none;
    margin: 0 0 9px;
    color: var(--faint);
    font-size: 11px;
    line-height: 1.45;
    text-wrap: pretty;
  }
  .secscroll {
    min-height: 0;
  }
  .psec.fill .secscroll {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Keep the scrollbar off the cards without inset padding on every child. */
    margin-right: -6px;
    padding-right: 6px;
  }
</style>
