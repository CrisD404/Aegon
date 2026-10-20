import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devFolderPlugin } from './dev/fs-plugin.ts';

// Sitio estático: corre igual en el navegador y, en la Fase 2, dentro de Tauri.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), devFolderPlugin()],
  server: { port: 5180, strictPort: true },
  preview: { port: 5181 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
