import '@tanstack/react-start/server-only'
import { getRouterInstance } from '@tanstack/react-start'

import { getExampleHost } from './server-host.ts'

export const handleApiRequest = async (request: Request): Promise<Response> => {
  const router = await getRouterInstance()
  try {
    const host = await getExampleHost()
    return await host.handleRequest(request)
  } finally {
    await router.options.context.dispose()
  }
}
