import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [svelte(), tailwindcss()],
  resolve: { alias: { $lib: resolve(__dirname, 'src/renderer/lib'), $shared: resolve(__dirname, 'src/shared') } },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
  }
});
