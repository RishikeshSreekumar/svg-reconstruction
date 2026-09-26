<script lang="ts">
  import { tooltip } from '../lib/tooltip.ts';

  let {
    id,
    label,
    value,
    onchange,
  }: {
    id: string;
    label: string;
    value: string | null | undefined;
    /** `live` marks a mid-drag picker value: part of one gesture, not a new edit. */
    onchange: (value: string, live?: boolean) => void;
  } = $props();

  const NAMED: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    gray: '#808080',
    grey: '#808080',
    transparent: '#000000',
  };

  function pickerColor(raw: string | null | undefined): string {
    const v = (raw ?? '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    if (/^#[0-9a-f]{3}$/.test(v)) return `#${v.slice(1).split('').map((c) => c + c).join('')}`;
    return NAMED[v] ?? '#000000';
  }

  const picker = $derived(pickerColor(value));
  const empty = $derived(value == null || value.trim() === '' || value.trim().toLowerCase() === 'none');
</script>

<div class="color-control">
  <input
    {id}
    class="color-text"
    value={value ?? 'none'}
    placeholder="none or CSS color"
    onchange={(e) => onchange((e.target as HTMLInputElement).value)}
  />
  <input
    class="color-picker"
    class:empty
    type="color"
    value={picker}
    aria-label={`Pick ${label.toLowerCase()}`}
    use:tooltip={empty ? `Pick ${label.toLowerCase()} (currently none)` : `Pick ${label.toLowerCase()}`}
    oninput={(e) => onchange((e.target as HTMLInputElement).value, true)}
    onchange={(e) => onchange((e.target as HTMLInputElement).value)}
  />
</div>
