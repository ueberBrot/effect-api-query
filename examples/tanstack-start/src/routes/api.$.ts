import { createFileRoute } from '@tanstack/react-router'

import { handleApiRequest } from '../lib/api-server.ts'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRequest(request),
      POST: ({ request }) => handleApiRequest(request),
      DELETE: ({ request }) => handleApiRequest(request),
    },
  },
})
