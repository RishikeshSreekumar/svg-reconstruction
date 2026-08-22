<script lang="ts">
  import { ICONS } from '../lib/icons.ts';

  let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags — icon markup is a local constant -->
  {@html ICONS[name] ?? ''}
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
