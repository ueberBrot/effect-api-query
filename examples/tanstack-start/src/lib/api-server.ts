import '@tanstack/react-start/server-only'
import { makeExampleWebHandler } from '@effect-api-query/server/web-handler'
import { getRouterInstance } from '@tanstack/react-start'
import { Effect, Exit, Scope } from 'effect'

const serverScope = Scope.makeUnsafe()
const serverHandler = Effect.runPromise(makeExampleWebHandler().pipe(Scope.provide(serverScope)))
let disposal: Promise<void> | undefined

const disposeServerHandler = (): Promise<void> => {
  disposal ??= Effect.runPromise(Scope.close(serverScope, Exit.void))
  return disposal
}

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => void disposeServerHandler())
}

/** Serves HTTP and RPC for the lifetime of this TanStack Start server module. */
export const handleApiRequest = async (request: Request): Promise<Response> => {
  const router = await getRouterInstance()
  try {
    const handler = await serverHandler
    return await handler(request)
  } finally {
    // Server routes bypass SSR cleanup. Release the ready clients created with the router.
    await router.options.context.dispose()
  }
}
