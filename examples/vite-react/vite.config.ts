import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const apiProxy = {
  '/api': 'http://127.0.0.1:3001',
  '/rpc': 'http://127.0.0.1:3001',
}

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: apiProxy,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: apiProxy,
    strictPort: true,
  },
})
