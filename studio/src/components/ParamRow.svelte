<script lang="ts" module>
  /** One editable number inside a parameter row. */
  export interface PField {
    key: string;
    value: number;
    /** Axis glyph shown inside the box — X, Y — for a two-up row. */
    axis?: string;
    /** Unit shown after the number, e.g. °. */
    unit?: string;
  }

  // Stable unique ids so every label is programmatically associated.
  let uid = 0;
</script>

<script lang="ts">
  import { store } from '../state/scene.svelte.ts';
  import { tooltip } from '../lib/tooltip.ts';

  let {
    label,
    fields,
    onchange,
  }: { label: string; fields: PField[]; onchange: (key: string, v: number) => void } = $props();

  const gid = `param-${++uid}`;
  const els: Record<string, HTMLInputElement | undefined> = {};

  // First keystroke — or first scrub pixel — of an editing burst takes the undo
  // checkpoint; blur or pointer release ends the burst.
  let dirty = false;

  const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();

  $effect(() => {
    for (const f of fields) {
      const el = els[f.key];
      if (el && document.activeElement !== el) el.value = fmt(f.value);
    }
  });

  function push(key: string, v: number): void {
    if (!Number.isFinite(v)) return;
    if (!dirty) {
      store.checkpoint();
      dirty = true;
    }
    onchange(key, v);
  }

  function oninput(f: PField): void {
    push(f.key, Number(els[f.key]!.value));
  }

  // Dragging a label or an axis glyph scrubs the value. It is the affordance a
  // geometry inspector is expected to have, and it lets the boxes drop the
  // native spin buttons that were eating a third of every field.
  function startScrub(e: PointerEvent, f: PField): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('scrubbing');
    const x0 = e.clientX;
    const v0 = f.value;

    const move = (m: PointerEvent): void => {
      const unit = f.unit === '°' ? 0.5 : 0.25;
      const step = unit * (m.shiftKey ? 10 : m.altKey ? 0.1 : 1);
      push(f.key, Math.round((v0 + (m.clientX - x0) * step) * 1000) / 1000);
    };
    const up = (): void => {
      handle.classList.remove('scrubbing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      dirty = false;
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
</script>

{#if fields.length === 1}
  <label class="plabel scrub" for="{gid}-0" use:tooltip={'Drag to adjust · shift ×10 · alt ×0.1'} onpointerdown={(e) => startScrub(e, fields[0])}>{label}</label>
{:else}
  <span class="plabel" id={gid}>{label}</span>
{/if}

<div class="pfields" role={fields.length > 1 ? 'group' : undefined} aria-labelledby={fields.length > 1 ? gid : undefined}>
  {#each fields as f, i (f.key)}
    <div class="pfield">
      {#if f.axis}
        <!-- svelte-ignore a11y_no_static_element_interactions — a pointer-only
             shortcut for the input beside it, which already steps with arrow keys -->
        <span class="paxis scrub" aria-hidden="true" use:tooltip={'Drag to adjust · shift ×10 · alt ×0.1'} onpointerdown={(e) => startScrub(e, f)}>{f.axis}</span>
      {/if}
      <input
        id="{gid}-{i}"
        bind:this={els[f.key]}
        type="number"
        step="any"
        aria-label={f.axis ? `${label} ${f.axis}` : label}
        oninput={() => oninput(f)}
        onblur={() => (dirty = false)}
      />
      {#if f.unit}<span class="punit">{f.unit}</span>{/if}
    </div>
  {/each}
</div>
