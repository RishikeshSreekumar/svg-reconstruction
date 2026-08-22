<script lang="ts">
  import { tools, TOOLS, TOOL_GROUPS } from '../state/tools.svelte.ts';
  import { store } from '../state/scene.svelte.ts';
  import { view } from '../state/view.svelte.ts';
  import { history } from '../state/history.svelte.ts';
  import { loadSVG } from '../lib/svg-load.ts';
  import Icon from './Icon.svelte';

  // View toggles live in the rail with the tools: they are all "how the canvas
  // behaves right now", while the top bar is for what enters and leaves the app.
  const toggles = $derived([
    {
      id: 'compare',
      label: 'Compare',
      icon: 'compare',
      on: view.compare,
      title: 'compare with the original — hover the canvas to wipe between them',
      flip: () => (view.compare = !view.compare),
    },
    { id: 'grid', label: 'Grid', icon: 'grid', on: view.showGrid, title: 'show the grid', flip: () => (view.showGrid = !view.showGrid) },
    { id: 'guides', label: 'Guides', icon: 'guides', on: view.showGuides, title: 'show guidelines', flip: () => (view.showGuides = !view.showGuides) },
    {
      id: 'snap',
      label: 'Snap',
      icon: 'snap',
      on: view.snap,
      title: 'snap drags to guidelines and the grid (hold Alt to bypass)',
      flip: () => (view.snap = !view.snap),
    },
    {
      id: 'constraints',
      label: 'Constraints',
      icon: 'constraints',
      on: store.enforce,
      title: 'keep detected equal-radius, alignment, concentric, mirror and rotational relationships while editing',
      flip: () => (store.enforce = !store.enforce),
    },
  ]);

  const historyBtns = $derived([
    { id: 'undo', icon: 'undo', title: 'Undo (Cmd+Z)', disabled: !history.canUndo, run: () => store.undo() },
    { id: 'redo', icon: 'redo', title: 'Redo (Shift+Cmd+Z)', disabled: !history.canRedo, run: () => store.redo() },
    {
      id: 'reset',
      icon: 'reset',
      title: 'Reset — throw the edits away and reconstruct the input again',
      disabled: !store.scene,
      run: () => void loadSVG(store.inputSVG),
    },
  ]);
</script>

<nav class="rail" aria-label="Toolbox">
  <div class="group" role="group" aria-label="Tools">
    {#each TOOL_GROUPS as g, gi (g)}
      {#if gi > 0}<div class="sep"></div>{/if}
      {#each TOOLS.filter((t) => t.group === g) as t (t.id)}
        <button
          class="railbtn"
          class:active={tools.current === t.id}
          title={t.title}
          aria-label={t.title}
          aria-pressed={tools.current === t.id}
          onclick={() => tools.set(t.id)}
        >
          <Icon name={t.icon} size={17} />
          <span class="key">{t.key.toUpperCase()}</span>
        </button>
      {/each}
    {/each}
  </div>

  <div class="rule"></div>

  <div class="group" role="group" aria-label="View">
    {#each toggles as t (t.id)}
      <button class="railbtn toggle" class:on={t.on} aria-pressed={t.on} title="{t.label} — {t.title}" aria-label={t.label} onclick={t.flip}>
        <Icon name={t.icon} size={17} />
      </button>
    {/each}
  </div>

  <div class="rule"></div>

  <div class="group" role="group" aria-label="History">
    {#each historyBtns as b (b.id)}
      <button class="railbtn" title={b.title} aria-label={b.title} disabled={b.disabled} onclick={b.run}>
        <Icon name={b.icon} size={17} />
      </button>
    {/each}
  </div>
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 7px;
    background: var(--bg);
    border-right: 1px solid var(--line);
    overflow-y: auto;
    overflow-x: hidden;
  }
  .group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .sep {
    width: 20px;
    height: 1px;
    background: var(--line);
    margin: 5px 0;
    flex: none;
  }
  .rule {
    width: 100%;
    height: 1px;
    background: var(--line);
    flex: none;
  }
  .railbtn {
    position: relative;
    width: 34px;
    height: 32px;
    display: grid;
    place-items: center;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    box-shadow: none;
    color: var(--dim);
    flex: none;
  }
  .railbtn:hover:not(:disabled) {
    color: var(--text);
    background: var(--panel2);
    border-color: transparent;
  }
  .railbtn:disabled {
    opacity: 0.3;
  }
  .railbtn.active {
    color: #fff;
    background: var(--primary);
    border-color: transparent;
  }
  .railbtn.active:hover {
    color: #fff;
    background: var(--primary-hover);
  }
  /* Toggles read as "lit", not "chosen" — a softer state than the active tool,
     because several of them can be on at once. */
  .railbtn.toggle.on {
    color: var(--primary);
    background: var(--primary-soft);
  }
  .railbtn.toggle.on:hover {
    color: var(--primary-hover);
    background: var(--primary-soft);
  }
  .key {
    position: absolute;
    right: 3px;
    bottom: 1px;
    font-size: 8px;
    line-height: 1;
    color: var(--faint);
    pointer-events: none;
  }
  .railbtn.active .key {
    color: rgba(255, 255, 255, 0.85);
  }
</style>
