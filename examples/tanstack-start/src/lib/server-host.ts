import '@tanstack/react-start/server-only'
import { makeExampleHost } from '@effect-api-query/server/web-handler'
import { Effect, Exit, Scope } from 'effect'

import { reportCleanupFailure } from './application.ts'
import { startServerApplication } from './server-application.ts'

const scope = Scope.makeUnsafe()
const host = Effect.runPromise(makeExampleHost().pipe(Scope.provide(scope)))
let disposal: Promise<void> | undefined

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    disposal ??= Effect.runPromise(Scope.close(scope, Exit.void))
    void reportCleanupFailure(disposal)
  })
}

export const getExampleHost = async () => host

export const startRequestApplication = async (request: Request) =>
  startServerApplication({
    host: await host,
    authorization: request.headers.get('x-example-authorization') ?? 'allowed',
    signal: request.signal,
  })
