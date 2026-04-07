import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: '../web',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@pinixai/core/web': path.resolve(__dirname, './node_modules/@pinixai/core/src/web.ts'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9007',
        changeOrigin: true,
      },
    },
  },
})
