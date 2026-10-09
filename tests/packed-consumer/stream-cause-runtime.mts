import { isCancelledError, QueryClient, QueryObserver } from '@tanstack/query-core'
import type { QueryKey } from '@tanstack/query-core'
import { Cause, Deferred, Effect, Equal, Schema, Stream } from 'effect'
import { createRpcQueryUtils, isEffectRpcQueryError } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import type { RpcClient } from 'effect/rpc'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, ok, rejects } from 'node:assert/strict'

const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
const group = RpcGroup.make(Watch)

const operations = ['streamed', 'live'] as const
const defect = new Error('stream defect')
const causes = [Cause.interrupt(42), Cause.combine(Cause.interrupt(42), Cause.die(defect))]

for (const operation of operations) {
  for (const cause of causes) {
    for (const emitted of [false, true]) {
      let finalized = false
      const failure = Stream.failCause(cause)
      const client = (() =>
        (emitted ? Stream.make('ready').pipe(Stream.concat(failure)) : failure).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              finalized = true
            }),
          ),
        )) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['interrupt', operation] })
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      try {
        const queryKey =
          operation === 'live' ? utils.events.watch.liveKey() : utils.events.watch.streamedKey()
        const query =
          operation === 'live'
            ? queryClient.query(utils.events.watch.liveOptions())
            : queryClient.query(utils.events.watch.streamedOptions())
        await rejects(query, (error: unknown) => {
          ok(isEffectRpcQueryError(error))
          equal(error.rpcTag, 'events.watch')
          equal(error.operation, operation)
          equal(
            Equal.equals(error.cause, cause),
            true,
            'Preserve the entire independent stream Cause',
          )
          equal(finalized, true)
          equal(queryClient.getQueryState(queryKey)?.status, 'error')
          equal(queryClient.getQueryState(queryKey)?.error, error)
          deepStrictEqual(
            queryClient.getQueryData(queryKey),
            emitted ? (operation === 'live' ? 'ready' : ['ready']) : undefined,
          )
          return true
        })
      } finally {
        queryClient.clear()
      }
    }
  }
}

for (const operation of operations) {
  const rejection = new Error('runner rejection')
  const runPromiseExit: RunPromiseExit = async () => await Promise.reject(rejection)
  const client = (() => Stream.empty) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
  const utils = createRpcQueryUtils(group, {
    client,
    keyPrefix: ['runner', operation],
    runPromiseExit,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    const query =
      operation === 'live'
        ? queryClient.query(utils.events.watch.liveOptions())
        : queryClient.query(utils.events.watch.streamedOptions())
    await rejects(query, (error: unknown) => {
      equal(error, rejection)
      return true
    })
  } finally {
    queryClient.clear()
  }
}

const wait = async (deferred: Deferred.Deferred<undefined>) =>
  await Effect.runPromise(Deferred.await(deferred).pipe(Effect.timeout('5 seconds')))

const settle = async (promise: PromiseLike<unknown>) => {
  try {
    return { status: 'success', data: await promise } as const
  } catch (error) {
    return { status: 'error', error } as const
  }
}

const waitForValue = async (queryClient: QueryClient, key: QueryKey, value: string) => {
  const published = Deferred.makeUnsafe<undefined>()
  const check = () => {
    const data = queryClient.getQueryData<string | readonly string[]>(key)
    if (data === value || (Array.isArray(data) && data.at(-1) === value)) {
      Effect.runSync(Deferred.succeed(published, undefined))
    }
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(check)
  try {
    check()
    await wait(published)
  } finally {
    unsubscribe()
  }
}

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const operation of operations) {
        const finalized = Deferred.makeUnsafe<undefined>()
        const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
          Effect.provide(
            group.toLayer({
              'events.watch': () =>
                Stream.make('first', 'second').pipe(
                  Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
                ),
            }),
          ),
        )
        const utils = createRpcQueryUtils(group, { client, keyPrefix: ['completion', operation] })
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        try {
          const result = yield* Effect.promise(
            async () =>
              await (operation === 'live'
                ? queryClient.query(utils.events.watch.liveOptions())
                : queryClient.query(utils.events.watch.streamedOptions())),
          )
          deepStrictEqual(result, operation === 'live' ? 'second' : ['first', 'second'])
          yield* Effect.promise(() => wait(finalized))
          const key =
            operation === 'live' ? utils.events.watch.liveKey() : utils.events.watch.streamedKey()
          equal(queryClient.getQueryState(key)?.status, 'success')
          equal(queryClient.getQueryState(key)?.fetchStatus, 'idle')
        } finally {
          queryClient.clear()
        }
      }

      for (const operation of operations) {
        for (const cached of [false, true]) {
          const started = Deferred.makeUnsafe<undefined>()
          const finalized = Deferred.makeUnsafe<undefined>()
          let signal: AbortSignal | undefined
          const runPromiseExit: RunPromiseExit = async (effect, options) => {
            signal = options?.signal
            return await Effect.runPromiseExit(effect, options)
          }
          const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
            Effect.provide(
              group.toLayer({
                'events.watch': () =>
                  Stream.fromEffect(
                    Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
                  ).pipe(
                    Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
                  ),
              }),
            ),
          )
          const utils = createRpcQueryUtils(group, {
            client,
            keyPrefix: ['cancellation', operation, cached],
            runPromiseExit,
          })
          const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
          const query = settle(
            operation === 'live'
              ? queryClient.query(
                  utils.events.watch.liveOptions(cached ? { initialData: 'cached' } : {}),
                )
              : queryClient.query(
                  utils.events.watch.streamedOptions(cached ? { initialData: ['cached'] } : {}),
                ),
          )
          const key =
            operation === 'live' ? utils.events.watch.liveKey() : utils.events.watch.streamedKey()
          try {
            yield* Effect.promise(() => wait(started))
            equal(signal?.aborted, false)
            yield* Effect.promise(() => queryClient.cancelQueries({ queryKey: key, exact: true }))
            yield* Effect.promise(() => wait(finalized))
            equal(signal?.aborted, true)
            const result = yield* Effect.promise(() => query)
            if (cached) {
              equal(result.status, 'success')
              ok(result.status === 'success')
              deepStrictEqual(result.data, operation === 'live' ? 'cached' : ['cached'])
            } else {
              equal(result.status, 'error')
              ok(result.status === 'error')
              ok(isCancelledError(result.error))
            }
            deepStrictEqual(
              queryClient.getQueryData(key),
              cached ? (operation === 'live' ? 'cached' : ['cached']) : undefined,
            )
            equal(queryClient.getQueryState(key)?.status, cached ? 'success' : 'pending')
            equal(queryClient.getQueryState(key)?.fetchStatus, 'idle')
            equal(queryClient.getQueryState(key)?.error, null)
          } finally {
            queryClient.clear()
          }
        }
      }

      for (const operation of operations) {
        const started = [Deferred.makeUnsafe<undefined>(), Deferred.makeUnsafe<undefined>()]
        const finalized = [Deferred.makeUnsafe<undefined>(), Deferred.makeUnsafe<undefined>()]
        let invocation = 0
        const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
          Effect.provide(
            group.toLayer({
              'events.watch': () => {
                const index = invocation++
                const start = started[index]!
                const finish = finalized[index]!
                return Stream.make(`run-${index + 1}`).pipe(
                  Stream.concat(
                    Stream.fromEffect(
                      Deferred.succeed(start, undefined).pipe(Effect.andThen(Effect.never)),
                    ),
                  ),
                  Stream.ensuring(Deferred.succeed(finish, undefined).pipe(Effect.asVoid)),
                )
              },
            }),
          ),
        )
        const utils = createRpcQueryUtils(group, { client, keyPrefix: ['refetch', operation] })
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const key =
          operation === 'live' ? utils.events.watch.liveKey() : utils.events.watch.streamedKey()
        const first = settle(
          operation === 'live'
            ? queryClient.query(utils.events.watch.liveOptions())
            : queryClient.query(utils.events.watch.streamedOptions()),
        )
        try {
          yield* Effect.promise(() => wait(started[0]!))
          yield* Effect.promise(() => waitForValue(queryClient, key, 'run-1'))
          const refetch = queryClient.refetchQueries({ queryKey: key, exact: true })
          yield* Effect.promise(() => wait(finalized[0]!))
          yield* Effect.promise(() => wait(started[1]!))
          yield* Effect.promise(() => waitForValue(queryClient, key, 'run-2'))
          deepStrictEqual(queryClient.getQueryData(key), operation === 'live' ? 'run-2' : ['run-2'])
          yield* Effect.promise(() => queryClient.cancelQueries({ queryKey: key, exact: true }))
          yield* Effect.promise(() => wait(finalized[1]!))
          yield* Effect.promise(() => refetch)
          const firstResult = yield* Effect.promise(() => first)
          if (firstResult.status === 'error') {
            ok(isCancelledError(firstResult.error))
          } else {
            deepStrictEqual(firstResult.data, operation === 'live' ? 'run-2' : ['run-2'])
          }
          equal(invocation, 2)
          equal(queryClient.getQueryState(key)?.error, null)
          equal(queryClient.getQueryState(key)?.fetchStatus, 'idle')
        } finally {
          queryClient.clear()
        }
      }

      for (const operation of operations) {
        const started = Deferred.makeUnsafe<undefined>()
        const finalized = Deferred.makeUnsafe<undefined>()
        const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
          Effect.provide(
            group.toLayer({
              'events.watch': () =>
                Stream.make('ready').pipe(
                  Stream.concat(
                    Stream.fromEffect(
                      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
                    ),
                  ),
                  Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
                ),
            }),
          ),
        )
        const utils = createRpcQueryUtils(group, { client, keyPrefix: ['observer', operation] })
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const observer =
          operation === 'live'
            ? new QueryObserver(queryClient, utils.events.watch.liveOptions())
            : new QueryObserver(queryClient, utils.events.watch.streamedOptions())
        const unsubscribe = observer.subscribe(() => {})
        try {
          yield* Effect.promise(() => wait(started))
          const key =
            operation === 'live' ? utils.events.watch.liveKey() : utils.events.watch.streamedKey()
          yield* Effect.promise(() => waitForValue(queryClient, key, 'ready'))
          equal(observer.getCurrentResult().status, 'success')
          unsubscribe()
          yield* Effect.promise(() => wait(finalized))
          equal(
            queryClient.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount(),
            0,
          )
          equal(queryClient.getQueryState(key)?.error, null)
          equal(queryClient.getQueryState(key)?.fetchStatus, 'idle')
        } finally {
          unsubscribe()
          queryClient.clear()
        }
      }
    }),
  ),
)

console.log('Packed stream Causes, runner rejections, cancellation, and lifecycle verified')
