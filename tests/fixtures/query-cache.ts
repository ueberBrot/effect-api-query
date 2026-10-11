import type { QueryClient } from '@tanstack/query-core'
import { Deferred, Effect, Exit } from 'effect'

export const waitForQueryState = Effect.fnUntraced(function* (
  queryClient: QueryClient,
  check: () => boolean,
) {
  const ready = yield* Deferred.make<undefined>()
  const observe = () => {
    if (check()) {
      Deferred.doneUnsafe(ready, Exit.succeed(undefined))
    }
  }
  yield* Effect.acquireRelease(
    Effect.sync(() => queryClient.getQueryCache().subscribe(observe)),
    (unsubscribe) => Effect.sync(unsubscribe),
  )
  observe()
  yield* Deferred.await(ready).pipe(Effect.timeout('5 seconds'))
}, Effect.scoped)
