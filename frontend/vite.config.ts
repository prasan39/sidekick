import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        timeout: 300000,  // 5 minutes timeout for M365 queries
        proxyTimeout: 300000,
      },
      // Note: WebSocket connections connect directly to backend in dev
      // (see useChat.ts). Avoid proxying /ws to prevent HMR conflicts.
    },
  },
})
