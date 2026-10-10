import '@tanstack/react-start/server-only'
import { getRouterInstance } from '@tanstack/react-start'

import { getExampleHost } from './server-host.ts'

/** Serves HTTP and RPC for the lifetime of this TanStack Start server module. */
export const handleApiRequest = async (request: Request): Promise<Response> => {
  const router = await getRouterInstance()
  try {
    const host = await getExampleHost()
    return await host.handleRequest(request)
  } finally {
    // Server routes bypass SSR cleanup. Release the ready clients created with the router.
    await router.options.context.dispose()
  }
}
