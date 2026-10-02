import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { imageProviderProxy } from './server/imageProxy';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: false, proxy: imageProviderProxy() },
  preview: { proxy: imageProviderProxy() },
  build: { chunkSizeWarningLimit: 1600 },
});
