import { NodeHttpServer } from '@effect/platform-node'
import { CancelledError, QueryClient } from '@tanstack/query-core'
import { Cause, Deferred, Effect, Exit, Predicate, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vite-plus/test'

import { createHttpApiQueryUtils } from '#effect-api-query'
import type { RunPromiseExit } from '#effect-api-query'

import { captureFailure } from './fixtures/async'

const Api = HttpApi.make('transport').add(
  HttpApiGroup.make('pages').add(
    HttpApiEndpoint.get('read', '/pages/:page', {
      params: { page: Schema.FiniteFromString },
      success: Schema.String,
    }),
  ),
)

describe('HTTP transport cancellation', () => {
  it.each(['query', 'later page'] as const)(
    'interrupts a %s and closes its real HTTP request',
    async (mode) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const requestReceived = yield* Deferred.make<undefined>()
          const requestDisconnected = yield* Deferred.make<undefined>()
          const interruption = yield* Deferred.make<Cause.Cause<unknown>>()
          const runSync = Effect.runSyncWith(yield* Effect.context())
          const paths: string[] = []
          const server = createServer((request, response) => {
            paths.push(request.url ?? '')
            if (request.url === '/pages/0') {
              response.setHeader('content-type', 'application/json')
              response.end(JSON.stringify('first'))
              return
            }
            response.on('close', () => {
              runSync(Deferred.succeed(requestDisconnected, undefined))
            })
            runSync(Deferred.succeed(requestReceived, undefined))
          })
          yield* NodeHttpServer.make(() => server, {
            host: '127.0.0.1',
            port: 0,
            disablePreemptiveShutdown: true,
          })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              server.closeAllConnections()
            }),
          )
          const address = server.address()
          if (address === null || Predicate.isString(address)) {
            throw new Error('Expected TCP address')
          }
          const queryClient = new QueryClient()
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              queryClient.clear()
            }),
          )
          const client = yield* HttpApiClient.make(Api, {
            baseUrl: `http://127.0.0.1:${address.port}`,
          }).pipe(Effect.provide(FetchHttpClient.layer))
          let requestSignal: AbortSignal | undefined
          const runPromiseExit: RunPromiseExit = async (effect, options) => {
            requestSignal = options?.signal
            const exit = await Effect.runPromiseExit(effect, options)
            if (Exit.isFailure(exit)) {
              runSync(Deferred.succeed(interruption, exit.cause))
            }
            return exit
          }
          const utils = createHttpApiQueryUtils(Api, {
            client,
            keyPrefix: ['test'],
            runPromiseExit,
          })
          const pending =
            mode === 'query'
              ? queryClient.query(utils.pages.read.queryOptions({ input: { params: { page: 1 } } }))
              : queryClient.infiniteQuery({
                  ...utils.pages.read.infiniteOptions({
                    initialPageParam: 0,
                    input: (page) => ({ params: { page } }),
                    getNextPageParam: (_last, _pages, page) => page + 1,
                  }),
                  pages: 2,
                })
          const result = captureFailure(pending)
          yield* Deferred.await(requestReceived)
          expect(requestSignal?.aborted).toBe(false)
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries({ queryKey: utils.pages.read.key() })
          })
          yield* Effect.promise(async () => {
            await expect(result).resolves.toBeInstanceOf(CancelledError)
          })
          expect(requestSignal?.aborted).toBe(true)
          expect(Cause.hasInterrupts(yield* Deferred.await(interruption))).toBe(true)
          yield* Deferred.await(requestDisconnected)
          expect(paths).toStrictEqual(mode === 'query' ? ['/pages/1'] : ['/pages/0', '/pages/1'])
          expect(queryClient.isFetching()).toBe(0)
        }).pipe(Effect.scoped),
      )
    },
  )
})
