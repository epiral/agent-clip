import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script([^>]*) crossorigin/g, '<script$1')
        .replace(/<link([^>]*rel="stylesheet"[^>]*) crossorigin/g, '<link$1')
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), removeCrossorigin()],
  base: '/',
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
