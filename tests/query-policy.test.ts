import { expect, it } from '@effect/vitest'
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { createRpcQueryUtils, withMutationPolicy, withQueryPolicy } from '#effect-api-query'

import { makeRpcTestClient } from './fixtures/effect-rpc'

it.effect('reuses typed query defaults while allowing call-site policy overrides', () =>
  Effect.gen(function* () {
    const group = RpcGroup.make(Rpc.make('read', { success: Schema.Int }))
    let version = 0
    const client = yield* makeRpcTestClient(group, {
      read: () =>
        Effect.sync(() => {
          version += 1
          return version
        }),
    })
    const utils = createRpcQueryUtils(group, { client, keyPrefix: ['query-policy'] })
    const read = withQueryPolicy(utils.read, 'query', { staleTime: Infinity })
    const queryClient = new QueryClient()
    expect(yield* Effect.promise(async () => await queryClient.query(read()))).toBe(1)
    expect(yield* Effect.promise(async () => await queryClient.query(read()))).toBe(1)
    expect(yield* Effect.promise(async () => await queryClient.query(read({ staleTime: 0 })))).toBe(
      2,
    )
  }),
)

it.effect('applies a reusable typed retry policy during native query execution', () =>
  Effect.gen(function* () {
    const group = RpcGroup.make(
      Rpc.make('read', { success: Schema.Int, error: Schema.Literal('busy') }),
    )
    let attempts = 0
    const client = yield* makeRpcTestClient(group, {
      read: () =>
        Effect.suspend(() => {
          attempts += 1
          return attempts === 1 ? Effect.fail('busy' as const) : Effect.succeed(42)
        }),
    })
    const utils = createRpcQueryUtils(group, { client, keyPrefix: ['retry-policy'] })
    const read = withQueryPolicy(utils.read, 'query', {
      retry: (count, error) => count === 0 && error.operation === 'query',
      retryDelay: 0,
    })
    expect(yield* Effect.promise(async () => await new QueryClient().query(read()))).toBe(42)
  }),
)

it.effect('shares mutation invalidation while call-site callbacks replace policy callbacks', () =>
  Effect.gen(function* () {
    const group = RpcGroup.make(
      Rpc.make('read', { success: Schema.Int }),
      Rpc.make('write', { payload: { value: Schema.Int }, success: Schema.Int }),
    )
    let value = 1
    const client = yield* makeRpcTestClient(group, {
      read: () => Effect.sync(() => value),
      write: ({ value: nextValue }) =>
        Effect.sync(() => {
          value = nextValue
          return value
        }),
    })
    const utils = createRpcQueryUtils(group, { client, keyPrefix: ['mutation-policy'] })
    const queryClient = new QueryClient()
    const read = withQueryPolicy(utils.read, 'query', { staleTime: Infinity })
    const write = withMutationPolicy(utils.write, {
      onSuccess: async (_data, _variables, _result, context) => {
        await context.client.invalidateQueries({ queryKey: utils.read.key() })
      },
    })
    yield* Effect.promise(async () => await queryClient.query(read()))
    const shared = new MutationObserver(queryClient, write())
    expect(yield* Effect.promise(async () => await shared.mutate({ value: 2 }))).toBe(2)
    expect(yield* Effect.promise(async () => await queryClient.query(read()))).toBe(2)

    let optimisticResult: number | undefined
    const local = new MutationObserver(
      queryClient,
      write({
        onMutate: (variables) => ({ previous: variables.value - 1 }),
        onSuccess: (_data, _variables, result) => {
          optimisticResult = result.previous
        },
      }),
    )
    expect(yield* Effect.promise(async () => await local.mutate({ value: 3 }))).toBe(3)
    expect(optimisticResult).toBe(2)
    expect(yield* Effect.promise(async () => await queryClient.query(read()))).toBe(2)
  }),
)
