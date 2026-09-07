import { expect, it } from '@effect/vitest'
import { MutationObserver, QueryClient, skipToken } from '@tanstack/query-core'
import { Context, Effect, Schema, Stream } from 'effect'
import type { Headers } from 'effect/unstable/http'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'

import {
  createRpcQueryUtils,
  type UnaryRpcOptions,
  type StreamingRpcOptions,
} from '#effect-api-query'

import { makeRpcTestClient } from './fixtures/effect-rpc'

const group = RpcGroup.make(
  Rpc.make('read', { payload: { page: Schema.Int }, success: Schema.String }),
  Rpc.make('watch', { payload: { page: Schema.Int }, success: Schema.String, stream: true }),
)

it.effect(
  'forwards request options on query executions and consumes them before returning options',
  () =>
    Effect.gen(function* () {
      const readyClient = yield* makeRpcTestClient(group, {
        read: (
          _payload: { readonly page: number },
          { headers }: { readonly headers: Headers.Headers },
        ) => Effect.succeed(headers['x-request-id'] ?? 'missing'),
        watch: (
          _payload: { readonly page: number },
          { headers }: { readonly headers: Headers.Headers },
        ) => Stream.succeed(headers['x-request-id'] ?? 'missing'),
      })
      const requests: unknown[] = []
      const client: typeof readyClient = (tag, payload, options) => {
        requests.push(options)
        return readyClient(tag, payload, options)
      }
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['requests'] })
      const rpcOptions = {
        headers: { 'x-request-id': 'query' },
        context: Context.empty(),
      } satisfies UnaryRpcOptions
      const options = utils.read.queryOptions({ input: { page: 0 }, rpcOptions, staleTime: 0 })
      const queryClient = new QueryClient()
      expect(yield* Effect.promise(() => queryClient.query(options))).toBe('query')
      expect(yield* Effect.promise(() => queryClient.query(options))).toBe('query')
      expect(requests).toEqual([rpcOptions, rpcOptions])
      expect(options).not.toHaveProperty('rpcOptions')
      expect(rpcOptions.headers).toEqual({ 'x-request-id': 'query' })
    }),
)

it.effect(
  'forwards static request options to every infinite page, mutation, and stream execution',
  () =>
    Effect.gen(function* () {
      const readyClient = yield* makeRpcTestClient(group, {
        read: (
          { page }: { readonly page: number },
          { headers }: { readonly headers: Headers.Headers },
        ) => Effect.succeed(`${headers['x-request-id']}:${page}`),
        watch: (
          _payload: { readonly page: number },
          { headers }: { readonly headers: Headers.Headers },
        ) => Stream.succeed(headers['x-request-id'] ?? 'missing'),
      })
      class RequestId extends Context.Service<RequestId, string>()(
        'RequestOptionsTest/RequestId',
      ) {}
      const context = Context.make(RequestId, 'local-context')
      const requests: unknown[] = []
      const client: typeof readyClient = (tag, payload, options) => {
        requests.push(options)
        return readyClient(tag, payload, options)
      }
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['requests'] })
      const queryClient = new QueryClient()
      const rpcOptions = { context, headers: { 'x-request-id': 'pages' } }
      const infinite = utils.read.infiniteOptions({
        input: (page: number) => ({ page }),
        initialPageParam: 0,
        getNextPageParam: (_last, _all, page) => page + 1,
        rpcOptions,
      })
      expect(
        yield* Effect.promise(() => queryClient.infiniteQuery({ ...infinite, pages: 2 })),
      ).toEqual({
        pageParams: [0, 1],
        pages: ['pages:0', 'pages:1'],
      })
      expect(requests).toEqual([rpcOptions, rpcOptions])
      const mutation = utils.read.mutationOptions({ rpcOptions })
      const observer = new MutationObserver(queryClient, mutation)
      expect(yield* Effect.promise(() => observer.mutate({ page: 3 }))).toBe('pages:3')
      expect(yield* Effect.promise(() => observer.mutate({ page: 4 }))).toBe('pages:4')
      expect(requests.slice(2)).toEqual([rpcOptions, rpcOptions])

      const streamOptions = { ...rpcOptions, streamBufferSize: 3 } satisfies StreamingRpcOptions
      const streamed = utils.watch.streamedOptions({
        input: { page: 0 },
        rpcOptions: streamOptions,
      })
      const live = utils.watch.liveOptions({ input: { page: 0 }, rpcOptions: streamOptions })
      expect(yield* Effect.promise(() => queryClient.query(streamed))).toEqual(['pages'])
      expect(yield* Effect.promise(() => queryClient.query(live))).toBe('pages')
      expect(requests.slice(4)).toEqual([streamOptions, streamOptions])
      for (const options of [infinite, mutation, streamed, live]) {
        expect(options).not.toHaveProperty('rpcOptions')
      }
      expect(Context.get(context, RequestId)).toBe('local-context')

      const skipped = [
        utils.read.queryOptions({ input: skipToken, rpcOptions }),
        utils.read.infiniteOptions({
          input: skipToken,
          rpcOptions,
          initialPageParam: 0,
          getNextPageParam: () => 1,
        }),
        utils.watch.streamedOptions({ input: skipToken, rpcOptions: streamOptions }),
        utils.watch.liveOptions({ input: skipToken, rpcOptions: streamOptions }),
      ]
      for (const options of skipped) {
        expect(options.queryFn).toBe(skipToken)
        expect(options).not.toHaveProperty('rpcOptions')
      }
      yield* Effect.promise(() =>
        queryClient.query(utils.read.queryOptions({ input: { page: 9 } })),
      )
      expect(requests.at(-1)).toBeUndefined()
    }),
)
