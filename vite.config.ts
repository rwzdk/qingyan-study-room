import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // 本地 Function fixture（dev/function-local.mjs）监听 8000。
      '/functions/v1/app': 'http://127.0.0.1:8000',
      // 本地 Cloudflare Worker（pnpm chat:dev）监听 8787。
      '/api/chat': 'http://127.0.0.1:8787',
    },
  },
});
