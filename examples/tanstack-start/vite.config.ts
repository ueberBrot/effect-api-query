import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    {
      name: 'preserve-api-request-cancellation',
      configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
          const path = request.url?.split('?')[0] ?? ''
          // Vite preview compression delays response close listeners until the first write.
          // Keep disconnect signals live while buffered HTTP and RPC requests are pending.
          if (path.startsWith('/api/') || path === '/rpc' || path === '/rpc/') {
            request.headers['accept-encoding'] = 'identity'
          }
          next()
        })
      },
    },
    tanstackStart(),
    tailwindcss(),
    react(),
  ],
  preview: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
})
