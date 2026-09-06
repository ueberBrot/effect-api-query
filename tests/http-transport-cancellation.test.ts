import { QueryClient, isCancelledError } from '@tanstack/query-core'
import { Cause, Effect, Exit, Schema } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vite-plus/test'

import { createHttpApiQueryUtils, type RunPromiseExit } from '#effect-api-query'

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
      let received!: () => void
      let disconnected!: () => void
      const requestReceived = new Promise<void>((resolve) => {
        received = resolve
      })
      const requestDisconnected = new Promise<void>((resolve) => {
        disconnected = resolve
      })
      const paths: string[] = []
      const server = createServer((request, response) => {
        paths.push(request.url ?? '')
        if (request.url === '/pages/0') {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify('first'))
          return
        }
        response.on('close', disconnected)
        received()
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Expected TCP address')
      const queryClient = new QueryClient()
      try {
        const client = await Effect.runPromise(
          HttpApiClient.make(Api, { baseUrl: `http://127.0.0.1:${address.port}` }).pipe(
            Effect.provide(FetchHttpClient.layer),
          ),
        )
        let interrupted!: (cause: Cause.Cause<unknown>) => void
        const interruption = new Promise<Cause.Cause<unknown>>((resolve) => {
          interrupted = resolve
        })
        let requestSignal: AbortSignal | undefined
        const runPromiseExit: RunPromiseExit = async (effect, options) => {
          requestSignal = options?.signal
          const exit = await Effect.runPromiseExit(effect, options)
          if (Exit.isFailure(exit)) interrupted(exit.cause)
          return exit
        }
        const utils = createHttpApiQueryUtils(Api, { client, keyPrefix: ['test'], runPromiseExit })
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
        const result = pending.catch((error: unknown) => error)
        await requestReceived
        expect(requestSignal?.aborted).toBe(false)
        await queryClient.cancelQueries({ queryKey: utils.pages.read.key() })
        expect(isCancelledError(await result)).toBe(true)
        expect(requestSignal?.aborted).toBe(true)
        expect(Cause.hasInterrupts(await interruption)).toBe(true)
        await requestDisconnected
        expect(paths).toEqual(mode === 'query' ? ['/pages/1'] : ['/pages/0', '/pages/1'])
        expect(queryClient.isFetching()).toBe(0)
      } finally {
        queryClient.clear()
        const closed = new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)))
        })
        server.closeAllConnections()
        await closed
      }
    },
  )
})
