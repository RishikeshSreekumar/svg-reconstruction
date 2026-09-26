<script lang="ts">
  let { viewBox, step, unit }: { viewBox: [number, number, number, number]; step: number; unit: number } = $props();
  const [x, y, w, h] = $derived(viewBox);
  const major = $derived(step * 5);
</script>

<defs>
  <pattern id="grid-minor" width={step} height={step} patternUnits="userSpaceOnUse">
    <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke="rgba(0,0,0,0.08)" stroke-width={unit} />
  </pattern>
  <pattern id="grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
    <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke="rgba(0,0,0,0.18)" stroke-width={unit} />
  </pattern>
</defs>
<rect {x} {y} width={w} height={h} fill="url(#grid-minor)" pointer-events="none" />
<rect {x} {y} width={w} height={h} fill="url(#grid-major)" pointer-events="none" />
