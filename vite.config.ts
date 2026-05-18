import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { appConfig, getApiOrigin } from './src/shared/app-config';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || appConfig.defaultBasePath,
  plugins: [react()],
  server: {
    host: appConfig.host,
    port: appConfig.webPort,
    strictPort: true,
    proxy: Object.fromEntries(appConfig.apiRoutes.map((route) => [route, getApiOrigin()]))
  },
  build: {
    outDir: appConfig.paths.clientDist,
    emptyOutDir: true
  }
});
