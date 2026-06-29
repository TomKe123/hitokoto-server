import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api/admin/ai/batch-classify/ws': {
        target: 'ws://localhost:7070',
        ws: true,
        changeOrigin: true,
      },
      '/api/admin/ai/review-batch/ws': {
        target: 'ws://localhost:7070',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:7070',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist'),
  },
})
