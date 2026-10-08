import { createFileRoute } from '@tanstack/react-router'

import { handleApiRequest } from '../lib/api-server.ts'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: async ({ request }) => handleApiRequest(request),
      POST: async ({ request }) => handleApiRequest(request),
      DELETE: async ({ request }) => handleApiRequest(request),
    },
  },
})
