import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { appConfig, getApiOrigin } from './src/shared/app-config';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || appConfig.defaultBasePath,
  plugins: [react(), tailwindcss()],
  server: {
    host: appConfig.host,
    port: appConfig.webPort,
    strictPort: true,
    // Allow Cloudflare quick-tunnel hostnames so the in-app tunnel admin can expose
    // the dev server publicly (Vite blocks unknown Host headers by default).
    allowedHosts: ['.trycloudflare.com'],
    proxy: Object.fromEntries(appConfig.apiRoutes.map((route) => [route, getApiOrigin()]))
  },
  build: {
    outDir: appConfig.paths.clientDist,
    emptyOutDir: true
  }
});
