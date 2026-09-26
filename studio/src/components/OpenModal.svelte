<script lang="ts">
  import { fitToStage, loadSample, loadSVG, looksLikeSVG, sampleLabel, sampleNames, samples } from '../lib/svg-load.ts';
  import { tooltip } from '../lib/tooltip.ts';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  type Tab = 'preset' | 'paste' | 'device';

  const TABS: { id: Tab; label: string; icon: string; hint: string }[] = [
    { id: 'preset', label: 'Preset SVG', icon: 'preset', hint: 'Bundled fixtures. Each one is flattened first, so the round trip is real.' },
    { id: 'paste', label: 'Paste SVG', icon: 'paste', hint: 'Paste markup straight from a design tool or an editor.' },
    { id: 'device', label: 'From device', icon: 'device', hint: 'Open an .svg file from this machine — or drop one anywhere on the app.' },
  ];

  let tab: Tab = $state('preset');
  let text = $state('');
  let err = $state('');
  let modalEl: HTMLDivElement | undefined = $state();

  const active = $derived(TABS.find((t) => t.id === tab)!);

  // Return focus to whatever opened the modal.
  $effect(() => {
    const prev = document.activeElement;
    return () => {
      if (prev instanceof HTMLElement) prev.focus();
    };
  });

  // Keep Tab inside the dialog while it is open.
  function trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !modalEl) return;
    const focusables = Array.from(modalEl.querySelectorAll<HTMLElement>('textarea, button, label.file')).filter((el) => !el.hasAttribute('disabled'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function pickPreset(key: string): void {
    loadSample(key);
    onclose();
  }

  function submitPaste(): void {
    if (!looksLikeSVG(text)) {
      err = 'that does not look like SVG markup';
      return;
    }
    void loadSVG(text);
    onclose();
  }

  function openFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    file.text().then((t) => {
      if (!looksLikeSVG(t)) {
        err = `${file.name} does not contain SVG markup`;
        return;
      }
      void loadSVG(t);
      onclose();
    });
  }
</script>

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  onkeydown={trapTab}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Open an SVG" bind:this={modalEl}>
    <header>
      <h2>Open an SVG</h2>
      <button class="mini" onclick={onclose} use:tooltip={'Close'} aria-label="Close"><Icon name="x" size={14} /></button>
    </header>

    <div class="tabs" role="tablist" aria-label="Source">
      {#each TABS as t (t.id)}
        <button
          class="tab"
          class:on={tab === t.id}
          role="tab"
          aria-selected={tab === t.id}
          onclick={() => {
            tab = t.id;
            err = '';
          }}
        >
          <Icon name={t.icon} size={16} />
          {t.label}
        </button>
      {/each}
    </div>
    <p class="hint">{active.hint}</p>

    <div class="body">
      {#if tab === 'preset'}
        <div class="presets">
          {#each sampleNames as n (n)}
            <button class="preset" onclick={() => pickPreset(n)}>
              <span class="art">{@html fitToStage(samples[n])}</span>
              <span class="name">{sampleLabel(n)}</span>
            </button>
          {/each}
        </div>
      {:else if tab === 'paste'}
        <!-- svelte-ignore a11y_autofocus -->
        <textarea bind:value={text} autofocus aria-label="SVG markup" placeholder="&lt;svg …&gt;…&lt;/svg&gt;"></textarea>
        <p class="tip">Cmd+V anywhere in the app also works when the clipboard holds SVG text.</p>
      {:else}
        <label class="file drop">
          <Icon name="device" size={22} />
          <span class="dtitle">Choose an .svg file</span>
          <span class="dsub">or drop one anywhere on the app</span>
          <input type="file" accept=".svg,image/svg+xml" onchange={openFile} />
        </label>
      {/if}
    </div>

    {#if err}<div class="err" role="alert">{err}</div>{/if}

    <footer>
      <button onclick={onclose}>Cancel</button>
      {#if tab === 'paste'}
        <button class="ibtn primary" onclick={submitPaste}>Reconstruct</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    z-index: 20;
  }
  .modal {
    width: min(680px, 92vw);
    max-height: 86vh;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow-lg);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    padding: 3px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 9px;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 7px 6px;
    background: transparent;
    border: none;
    border-radius: 7px;
    box-shadow: none;
    color: var(--dim);
    font-size: 12px;
  }
  .tab:hover {
    color: var(--text);
    background: var(--panel2);
    border-color: transparent;
  }
  .tab.on {
    color: var(--primary);
    background: var(--bg);
    font-weight: 500;
    box-shadow: var(--shadow-sm);
  }
  .hint {
    margin: -4px 2px 0;
    color: var(--dim);
    font-size: 11px;
  }
  .body {
    min-height: 260px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 8px;
    overflow-y: auto;
    padding: 2px;
    max-height: 46vh;
  }
  .preset {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    overflow: hidden;
    border-radius: 9px;
    border-color: var(--line);
    box-shadow: none;
    background: var(--bg);
  }
  .preset:hover {
    border-color: var(--primary);
    background: var(--bg);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  .preset .art {
    display: grid;
    place-items: center;
    height: 76px;
    padding: 8px;
    background: #fff;
    border-bottom: 1px solid var(--line);
  }
  .preset .art :global(svg) {
    max-width: 100%;
    max-height: 100%;
  }
  .preset .name {
    padding: 5px 7px;
    font-size: 10px;
    color: var(--dim);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .preset:hover .name {
    color: var(--text);
  }

  textarea {
    flex: 1;
    min-height: 220px;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    padding: 10px;
    font: 12px/1.5 "IBM Plex Mono", ui-monospace, "SF Mono", monospace;
    resize: none;
  }
  textarea:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  .tip {
    margin: 8px 0 0;
    color: var(--faint);
    font-size: 11px;
  }

  .drop {
    flex: 1;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    border: 1.5px dashed var(--line-strong);
    border-radius: 11px;
    background: var(--panel);
    color: var(--dim);
    padding: 28px;
  }
  .drop:hover {
    border-color: var(--primary);
    background: var(--primary-soft);
    color: var(--primary);
  }
  .dtitle {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
  }
  .drop:hover .dtitle {
    color: var(--primary);
  }
  .dsub {
    font-size: 11px;
    color: var(--faint);
  }

  .err {
    color: var(--bad);
    background: var(--bad-soft);
    border-radius: 7px;
    padding: 6px 9px;
    font-size: 11px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
