import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [svelte()],
  // The engine and the fixtures live outside the studio root.
  server: { fs: { allow: [resolve(here, '..')] } },
  build: { outDir: resolve(here, '..', '.studio-dist'), emptyOutDir: true },
});
