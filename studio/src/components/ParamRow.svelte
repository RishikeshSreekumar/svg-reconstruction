<script lang="ts" module>
  // Stable unique ids so every label is programmatically associated.
  let uid = 0;
</script>

<script lang="ts">
  import { store } from '../state/scene.svelte.ts';

  let {
    label,
    value,
    deg = false,
    onchange,
  }: { label: string; value: number; deg?: boolean; onchange: (v: number) => void } = $props();

  const id = `param-${++uid}`;

  let el: HTMLInputElement | undefined = $state();
  // First keystroke of an editing burst takes the undo checkpoint; blur ends the burst.
  let dirty = false;

  const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();

  $effect(() => {
    const v = fmt(value);
    if (el && document.activeElement !== el) el.value = v;
  });

  function oninput(): void {
    const v = Number(el!.value);
    if (!Number.isFinite(v)) return;
    if (!dirty) {
      store.checkpoint();
      dirty = true;
    }
    onchange(v);
  }
</script>

<label for={id}>{label}{deg ? '°' : ''}</label>
<input {id} bind:this={el} type="number" step="any" {oninput} onblur={() => (dirty = false)} />
