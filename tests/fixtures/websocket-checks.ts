import { CancelledError } from '@tanstack/query-core'
import type { QueryClient, QueryKey } from '@tanstack/query-core'
import { Cause, Deferred, Effect, Equal, Exit, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'
import { deepStrictEqual, equal, ok } from 'node:assert/strict'

import { isEffectRpcQueryError } from '#effect-api-query'

import {
  runSocketCase,
  serveSocketGroup,
} from '../../examples/server/tests/fixtures/websocket-server.ts'
import { readSocketSnapshot } from './docs-websocket-use.ts'
import { acquireSocketQueries } from './socket-client.ts'

interface RetiringSocketOwner {
  queryClient: QueryClient | undefined
}

const wait = <A>(deferred: Deferred.Deferred<A>) =>
  Deferred.await(deferred).pipe(Effect.timeout('5 seconds'))

const waitForData = async (
  queryClient: QueryClient,
  queryKey: QueryKey,
  expected: number | readonly number[],
) => {
  const published = Deferred.makeUnsafe<undefined>()
  const check = () => {
    const data = queryClient.getQueryData(queryKey)
    if (JSON.stringify(data) === JSON.stringify(expected)) {
      Effect.runSync(Deferred.succeed(published, undefined))
    }
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(check)
  try {
    check()
    await Effect.runPromise(wait(published))
  } finally {
    unsubscribe()
  }
}

const settle = async (promise: PromiseLike<unknown>) => {
  try {
    return { status: 'success', data: await promise } as const
  } catch (error) {
    return { status: 'failure', error } as const
  }
}

export const exerciseSocketConcurrency = async () =>
  await runSocketCase(
    Effect.gen(function* () {
      const readsStarted = yield* Deferred.make<undefined>()
      const releaseReads = yield* Deferred.make<undefined>()
      const releaseSecond = yield* Deferred.make<undefined>()
      const historyClosed = yield* Deferred.make<undefined>()
      const liveClosed = yield* Deferred.make<undefined>()
      let started = 0
      const url = yield* serveSocketGroup({
        'values.read': Effect.fnUntraced(function* ({ id }) {
          started += 1
          if (started === 2) {
            yield* Deferred.succeed(readsStarted, undefined)
          }
          yield* Deferred.await(releaseReads)
          return id * 10
        }),
        'values.watch': ({ channel }) =>
          Stream.succeed(1).pipe(
            Stream.concat(
              channel === 'clock'
                ? Stream.empty
                : Stream.fromEffect(Deferred.await(releaseSecond).pipe(Effect.as(2))),
            ),
            Stream.concat(Stream.fromEffect(Effect.never)),
            Stream.ensuring(
              Deferred.succeed(channel === 'history' ? historyClosed : liveClosed, undefined).pipe(
                Effect.asVoid,
              ),
            ),
          ),
      })
      const { queryClient, rpc, dispose } = yield* acquireSocketQueries(url, 'first')
      const reads = [1, 2].map(
        async (id) => await queryClient.query(rpc.values.read.queryOptions({ input: { id } })),
      )
      const historyOptions = rpc.values.watch.streamedOptions({
        input: { channel: 'history' },
        rpcOptions: { streamBufferSize: 16 },
      })
      const liveOptions = rpc.values.watch.liveOptions({
        input: { channel: 'live' },
        rpcOptions: { streamBufferSize: 16 },
      })
      const history = settle(queryClient.query(historyOptions))
      const live = settle(queryClient.query(liveOptions))
      yield* wait(readsStarted)
      yield* Effect.promise(async () => {
        await waitForData(queryClient, historyOptions.queryKey, [1])
      })
      yield* Effect.promise(async () => {
        await waitForData(queryClient, liveOptions.queryKey, 1)
      })
      equal(queryClient.getQueryState(historyOptions.queryKey)?.status, 'success')
      equal(queryClient.getQueryState(historyOptions.queryKey)?.fetchStatus, 'fetching')
      equal(queryClient.getQueryState(liveOptions.queryKey)?.status, 'success')
      equal(queryClient.getQueryState(liveOptions.queryKey)?.fetchStatus, 'fetching')
      equal(yield* Deferred.isDone(historyClosed), false)
      equal(yield* Deferred.isDone(liveClosed), false)
      yield* Effect.promise(async () => {
        await queryClient.cancelQueries({ queryKey: historyOptions.queryKey, exact: true })
      })
      yield* wait(historyClosed)
      const historyResult = yield* Effect.promise(async () => await history)
      equal(historyResult.status, 'success')
      if (historyResult.status === 'success') {
        deepStrictEqual(historyResult.data, [1])
      }
      equal(yield* Deferred.isDone(liveClosed), false)
      equal(queryClient.getQueryState(liveOptions.queryKey)?.fetchStatus, 'fetching')
      yield* Deferred.succeed(releaseSecond, undefined)
      yield* Effect.promise(async () => {
        await waitForData(queryClient, liveOptions.queryKey, 2)
      })
      yield* Deferred.succeed(releaseReads, undefined)
      const values = yield* Effect.promise(async () => await Promise.all(reads))
      deepStrictEqual(values, [10, 20])
      yield* Effect.promise(async () => {
        await queryClient.cancelQueries({ queryKey: liveOptions.queryKey, exact: true })
      })
      yield* wait(liveClosed)
      const liveResult = yield* Effect.promise(async () => await live)
      equal(liveResult.status, 'success')
      if (liveResult.status === 'success') {
        equal(liveResult.data, 2)
      }
      deepStrictEqual(yield* readSocketSnapshot(url), {
        reads: [10, 20],
        history: [1],
        latest: 1,
      })
      yield* dispose
      equal(queryClient.isFetching(), 0)
      equal(queryClient.getQueryCache().getAll().length, 0)
      return {
        reads: values,
        history: [1],
        latest: 1,
        historyCancelled: true,
        liveContinued: 2,
        liveCancelled: true,
      }
    }),
  )

export const exerciseSocketInterruption = async () =>
  await runSocketCase(
    Effect.gen(function* () {
      const readStarted = yield* Deferred.make<undefined>()
      const releaseRead = yield* Deferred.make<undefined>()
      const url = yield* serveSocketGroup({
        'values.read': Effect.fnUntraced(function* ({ id }) {
          if (id < 0) {
            return yield* Effect.failCause(Cause.interrupt(42))
          }
          yield* Deferred.succeed(readStarted, undefined)
          yield* Deferred.await(releaseRead)
          return id * 10
        }),
        'values.watch': ({ channel }) => {
          const interruption = Stream.failCause(Cause.interrupt(42))
          return channel.endsWith('emitted')
            ? Stream.succeed(7).pipe(Stream.concat(interruption))
            : interruption
        },
      })
      const { client, rpc, queryClient, dispose } = yield* acquireSocketQueries(url, 'interrupted')
      const unaffected = queryClient.query(rpc.values.read.queryOptions({ input: { id: 3 } }))
      yield* wait(readStarted)
      const nativeUnary = yield* client('values.read', { id: -1 }).pipe(Effect.exit)
      const generatedUnary = yield* Effect.promise(
        async () =>
          await settle(queryClient.query(rpc.values.read.queryOptions({ input: { id: -1 } }))),
      )
      ok(Exit.isFailure(nativeUnary))
      equal(generatedUnary.status, 'failure')
      if (generatedUnary.status === 'failure') {
        ok(isEffectRpcQueryError(generatedUnary.error))
        equal(generatedUnary.error.operation, 'query')
        equal(Equal.equals(nativeUnary.cause, generatedUnary.error.cause), true)
        equal(Cause.hasInterruptsOnly(generatedUnary.error.cause), true)
      }
      for (const view of ['streamed', 'live'] as const) {
        for (const emitted of [false, true]) {
          const input = { channel: `${view}-${emitted ? 'emitted' : 'empty'}` }
          const nativeStream = yield* client('values.watch', input, {
            streamBufferSize: 16,
          }).pipe(Stream.runCollect, Effect.exit)
          const options =
            view === 'streamed'
              ? rpc.values.watch.streamedOptions({ input, rpcOptions: { streamBufferSize: 16 } })
              : rpc.values.watch.liveOptions({ input, rpcOptions: { streamBufferSize: 16 } })
          const generatedStream = yield* Effect.promise(
            async () =>
              await settle(
                view === 'streamed'
                  ? queryClient.query(
                      rpc.values.watch.streamedOptions({
                        input,
                        rpcOptions: { streamBufferSize: 16 },
                      }),
                    )
                  : queryClient.query(
                      rpc.values.watch.liveOptions({ input, rpcOptions: { streamBufferSize: 16 } }),
                    ),
              ),
          )
          ok(Exit.isFailure(nativeStream))
          equal(generatedStream.status, 'failure')
          if (generatedStream.status === 'failure') {
            ok(isEffectRpcQueryError(generatedStream.error))
            equal(generatedStream.error.rpcTag, 'values.watch')
            equal(generatedStream.error.operation, view)
            equal(Equal.equals(nativeStream.cause, generatedStream.error.cause), true)
            equal(Cause.hasInterruptsOnly(generatedStream.error.cause), true)
            equal(queryClient.getQueryState(options.queryKey)?.error, generatedStream.error)
            equal(queryClient.getQueryState(options.queryKey)?.status, 'error')
          }
          const emittedData = view === 'streamed' ? [7] : 7
          deepStrictEqual(
            queryClient.getQueryData(options.queryKey),
            emitted ? emittedData : undefined,
          )
          equal(
            queryClient.getQueryState(rpc.values.read.queryKey({ id: 3 }))?.fetchStatus,
            'fetching',
          )
        }
      }
      yield* Deferred.succeed(releaseRead, undefined)
      const unaffectedRead = yield* Effect.promise(async () => await unaffected)
      equal(unaffectedRead, 30)
      yield* dispose
      return { comparedWireCauses: 5, unaffectedRead }
    }),
  )

export const exerciseSocketReplacement = async () =>
  await runSocketCase(
    Effect.gen(function* () {
      const oldClosed = yield* Deferred.make<undefined>()
      const unrelatedClosed = yield* Deferred.make<undefined>()
      const replacementClosed = yield* Deferred.make<undefined>()
      const releaseSecond = yield* Deferred.make<undefined>()
      const readStarted = yield* Deferred.make<undefined>()
      const disconnected = yield* Deferred.make<undefined>()
      const ownerFinalizers = [oldClosed, replacementClosed]
      const url = yield* serveSocketGroup({
        'values.read': () =>
          Deferred.succeed(readStarted, undefined).pipe(Effect.andThen(Effect.never)),
        'values.watch': ({ channel }) => {
          const finalized = channel === 'owner-a' ? ownerFinalizers.shift() : unrelatedClosed
          if (finalized === undefined) {
            return Stream.die(new Error('Unexpected owner acquisition'))
          }
          return Stream.succeed(1).pipe(
            Stream.concat(Stream.fromEffect(Deferred.await(releaseSecond).pipe(Effect.as(2)))),
            Stream.concat(Stream.fromEffect(Effect.never)),
            Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
          )
        },
      })
      const retiringOwner: RetiringSocketOwner = { queryClient: undefined }
      const oldOwner = yield* acquireSocketQueries(url, 'a').pipe(
        Effect.provideService(RpcClient.ConnectionHooks, {
          onConnect: Effect.void,
          onDisconnect: Effect.gen(function* () {
            equal(retiringOwner.queryClient?.isFetching(), 0)
            equal(retiringOwner.queryClient?.getQueryCache().getAll().length, 0)
            yield* Deferred.succeed(disconnected, undefined)
          }),
        }),
      )
      retiringOwner.queryClient = oldOwner.queryClient
      const unrelatedOwner = yield* acquireSocketQueries(url, 'b')
      const oldOptions = oldOwner.rpc.values.watch.liveOptions({ input: { channel: 'owner-a' } })
      const unrelatedOptions = unrelatedOwner.rpc.values.watch.liveOptions({
        input: { channel: 'owner-b' },
      })
      const oldRead = settle(
        oldOwner.queryClient.query(oldOwner.rpc.values.read.queryOptions({ input: { id: 1 } })),
      )
      const oldStream = settle(oldOwner.queryClient.query(oldOptions))
      const unrelatedStream = settle(unrelatedOwner.queryClient.query(unrelatedOptions))
      yield* wait(readStarted)
      yield* Effect.promise(async () => {
        await waitForData(oldOwner.queryClient, oldOptions.queryKey, 1)
      })
      yield* Effect.promise(async () => {
        await waitForData(unrelatedOwner.queryClient, unrelatedOptions.queryKey, 1)
      })
      yield* oldOwner.dispose
      yield* wait(disconnected)
      yield* wait(oldClosed)
      const cancelledRead = yield* Effect.promise(async () => await oldRead)
      equal(cancelledRead.status, 'failure')
      if (cancelledRead.status === 'failure') {
        equal(cancelledRead.error instanceof CancelledError, true)
      }
      yield* Effect.promise(async () => await oldStream)
      equal(yield* Deferred.isDone(unrelatedClosed), false)
      equal(
        unrelatedOwner.queryClient.getQueryState(unrelatedOptions.queryKey)?.fetchStatus,
        'fetching',
      )
      const replacement = yield* acquireSocketQueries(url, 'a')
      const replacementOptions = replacement.rpc.values.watch.liveOptions({
        input: { channel: 'owner-a' },
      })
      deepStrictEqual(replacementOptions.queryKey, oldOptions.queryKey)
      equal(replacement.queryClient === oldOwner.queryClient, false)
      const replacementStream = settle(replacement.queryClient.query(replacementOptions))
      yield* Effect.promise(async () => {
        await waitForData(replacement.queryClient, replacementOptions.queryKey, 1)
      })
      yield* Deferred.succeed(releaseSecond, undefined)
      yield* Effect.promise(async () => {
        await waitForData(unrelatedOwner.queryClient, unrelatedOptions.queryKey, 2)
      })
      yield* Effect.promise(async () => {
        await waitForData(replacement.queryClient, replacementOptions.queryKey, 2)
      })
      equal(oldOwner.queryClient.getQueryCache().getAll().length, 0)
      yield* unrelatedOwner.dispose
      yield* replacement.dispose
      yield* wait(unrelatedClosed)
      yield* wait(replacementClosed)
      yield* Effect.promise(async () => await Promise.all([unrelatedStream, replacementStream]))
      return {
        oldOwnerCancelled: true,
        unrelatedOwnerContinued: 2,
        replacementValue: 1,
        disconnectsAfterQueryCancellation: true,
      }
    }),
  )
