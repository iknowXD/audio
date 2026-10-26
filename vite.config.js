import { defineConfig } from 'vite';
import {audioDev} from './server/dev-plugin.mjs';
import {sites} from './scripts/vite/sites-vite-plugin.ts';
export default defineConfig({
  plugins:[audioDev(),sites({mockAuth:false})],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  build: { target:'es2022',outDir:'dist/client', rollupOptions: { input: { player: 'index.html', editor: 'editor.html', privacy: 'privacy.html' } } }
});
