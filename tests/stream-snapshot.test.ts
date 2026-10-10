import { it } from '@effect/vitest'
import { QueryClient, QueryObserver } from '@tanstack/query-core'
import { Deferred, Effect, Exit, Schema, Stream } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { describe, expect, it as test } from 'vite-plus/test'

import { createRpcQueryUtils, fetchStreamSnapshot } from '#effect-api-query'

import { captureFailure } from './fixtures/async.ts'
import { makeRpcTestClient } from './fixtures/effect-rpc.ts'

describe('stream snapshots', () => {
  it.effect(
    'uses cached snapshots without acquiring a stream and requires ownership for fresh capture',
    () =>
      Effect.gen(function* () {
        const group = RpcGroup.make(Rpc.make('watch', { success: Schema.Int, stream: true }))
        const entered = yield* Deferred.make<undefined>()
        const emit = yield* Deferred.make<undefined>()
        const finalized = yield* Deferred.make<undefined>()
        let executions = 0
        const client = yield* makeRpcTestClient(group, {
          watch: () =>
            Stream.fromEffect(
              Effect.sync(() => {
                executions += 1
              }).pipe(
                Effect.andThen(Deferred.succeed(entered, undefined)),
                Effect.andThen(Deferred.await(emit)),
                Effect.as(1),
              ),
            ).pipe(
              Stream.concat(Stream.never),
              Stream.ensuring(Deferred.succeed(finalized, undefined)),
            ),
        })
        const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['snapshot'] })
        const options = rpc.watch.liveOptions({ retry: false, staleTime: Infinity })
        const queryClient = new QueryClient()
        try {
          queryClient.setQueryData(options.queryKey, 0)
          expect(
            yield* Effect.promise(
              async () => await fetchStreamSnapshot(queryClient, options, { mode: 'cached' }),
            ),
          ).toBe(0)
          expect(executions).toBe(0)
          const pending = captureFailure(fetchStreamSnapshot(queryClient, options))
          yield* Deferred.await(entered)
          yield* Effect.promise(async () => {
            await expect(fetchStreamSnapshot(queryClient, options)).rejects.toThrow(
              'idle query without observers',
            )
          })
          expect(Deferred.isDoneUnsafe(finalized)).toBe(false)
          yield* Deferred.succeed(emit, undefined)
          expect(yield* Effect.promise(async () => await pending)).toBe(1)
          yield* Deferred.await(finalized)
          expect(executions).toBe(1)
          const observer = new QueryObserver(queryClient, { ...options, enabled: false })
          const stop = observer.subscribe(() => {})
          try {
            yield* Effect.promise(async () => {
              await expect(fetchStreamSnapshot(queryClient, options)).rejects.toThrow(
                'idle query without observers',
              )
            })
            expect(
              yield* Effect.promise(
                async () => await fetchStreamSnapshot(queryClient, options, { mode: 'cached' }),
              ),
            ).toBe(1)
          } finally {
            stop()
          }
          expect(queryClient.isFetching()).toBe(0)
          expect(queryClient.getQueryCache().hasListeners()).toBe(false)
        } finally {
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries()
          })
          queryClient.clear()
        }
      }),
  )

  test.each(['timeout', 'abort', 'cleanup-failure'] as const)(
    'settles a %s snapshot after query cleanup',
    async (path) => {
      const queryClient = new QueryClient()
      const entered = Deferred.makeUnsafe<undefined>()
      const closing = Deferred.makeUnsafe<undefined>()
      const release = Deferred.makeUnsafe<undefined>()
      const controller = new AbortController()
      const abortReason = new Error('request aborted')
      const cleanupError = new Error('cleanup failed')
      let finalized = false
      let settled = false
      const options = {
        queryKey: ['snapshot-cleanup', path],
        retry: false,
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<number> => {
          Deferred.doneUnsafe(entered, Exit.succeed(undefined))
          if (path === 'cleanup-failure') {
            queryClient.setQueryData(options.queryKey, 1)
          }
          const interrupted = await captureFailure(Effect.runPromise(Effect.never, { signal }))
          Deferred.doneUnsafe(closing, Exit.succeed(undefined))
          await Effect.runPromise(Deferred.await(release))
          finalized = true
          throw path === 'cleanup-failure' ? cleanupError : interrupted
        },
      }
      const pending = fetchStreamSnapshot(queryClient, options, {
        signal: controller.signal,
        timeoutMs: path === 'timeout' ? 10 : 1000,
      })
      const outcome = captureFailure(pending).then((result) => {
        settled = true
        return result
      })
      try {
        await Effect.runPromise(Deferred.await(entered))
        if (path === 'abort') {
          controller.abort(abortReason)
        }
        await Effect.runPromise(Deferred.await(closing))
        expect(settled).toBe(false)
        expect(finalized).toBe(false)
        Effect.runSync(Deferred.succeed(release, undefined))
        const result = await outcome
        const failure = {
          timeout: { name: 'TimeoutError' },
          abort: abortReason,
          'cleanup-failure': cleanupError,
        }[path]
        expect(result).toMatchObject(failure)
        expect(path === 'timeout' || result === failure).toBe(true)
        expect(finalized).toBe(true)
        expect(queryClient.isFetching()).toBe(0)
        expect(queryClient.getQueryCache().hasListeners()).toBe(false)
      } finally {
        Effect.runSync(Deferred.succeed(release, undefined))
        await queryClient.cancelQueries()
        await outcome
        queryClient.clear()
      }
    },
  )

  test('rejects an aborted snapshot before executing the query', async () => {
    const queryClient = new QueryClient()
    const controller = new AbortController()
    const reason = new Error('request already aborted')
    controller.abort(reason)
    let executions = 0
    try {
      await expect(
        fetchStreamSnapshot(
          queryClient,
          {
            queryKey: ['aborted'],
            queryFn: async () => {
              executions += 1
              return await Promise.resolve(1)
            },
          },
          { signal: controller.signal },
        ),
      ).rejects.toBe(reason)
      expect(executions).toBe(0)
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    } finally {
      queryClient.clear()
    }
  })
})
