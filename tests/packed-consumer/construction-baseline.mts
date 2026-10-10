import { QueryClient } from '@tanstack/query-core'
import { Clock, Effect, Layer, Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  EffectRpcQueryConfigError,
  EffectRpcQueryKeyError,
  type JsonValue,
} from 'effect-api-query'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from 'effect/http-api'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, ok, throws } from 'node:assert/strict'

const Payload = Schema.Struct({
  id: Schema.Int,
  locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
  rows: Schema.Array(
    Schema.Struct({ id: Schema.Int, title: Schema.String, flags: Schema.Array(Schema.Boolean) }),
  ),
})
const input = (count: number) => ({
  id: 1,
  rows: Array.from({ length: count }, (_, id) => ({
    id,
    title: `record-${id}`,
    flags: [true, false],
  })),
})
const records = [1, 100] as const
const operationCounts = [1, 250] as const
const samples = 5
const measurements: {
  adapter: 'rpc' | 'http'
  stage: string
  operations: number
  records: number
  iterations: number
  milliseconds: number[]
}[] = []

const measure = (
  clock: Clock.Clock,
  adapter: 'rpc' | 'http',
  stage: string,
  operations: number,
  recordCount: number,
  iterations: number,
  operation: () => unknown,
) => {
  for (let warmup = 0; warmup < 20; warmup += 1) operation()
  const milliseconds = Array.from({ length: samples }, () => {
    const started = clock.monotonicTimeNanosUnsafe()
    for (let iteration = 0; iteration < iterations; iteration += 1) operation()
    return Number(clock.monotonicTimeNanosUnsafe() - started) / 1_000_000
  })
  measurements.push({ adapter, stage, operations, records: recordCount, iterations, milliseconds })
}

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      for (const operationCount of operationCounts) {
        const rpcs = Array.from({ length: operationCount }, (_, index) =>
          Rpc.make(`records.read-${index}`, { payload: Payload, success: Schema.Int }),
        )
        const group = RpcGroup.make(...rpcs)
        const rpcClient = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
          Effect.provide(
            group.toLayer(
              Object.fromEntries(
                rpcs.map((rpc) => [
                  rpc._tag,
                  (value: typeof Payload.Type) => Effect.succeed(value.id),
                ]),
              ),
            ),
          ),
        )
        const rpcFactory = () =>
          createRpcQueryUtils(group, { client: rpcClient, keyPrefix: ['construction', 'owner-a'] })
        const rpc = rpcFactory()
        equal(Object.isFrozen(rpc), true)
        equal(Object.isFrozen(rpc.records), true)
        equal(Object.keys(rpc.records).length, operationCount + 1)
        equal(Object.isFrozen(rpc.records['read-0']), true)
        measure(clock, 'rpc', 'factory', operationCount, 0, 50, rpcFactory)

        const endpoint = (index: number) =>
          HttpApiEndpoint.post(`read-${index}`, `/read-${index}/:owner`, {
            params: { owner: Schema.NumberFromString },
            payload: Payload,
            success: Schema.Int,
          })
        const endpoints = [
          endpoint(0),
          ...Array.from({ length: operationCount - 1 }, (_, index) => endpoint(index + 1)),
        ] as const
        const api = HttpApi.make('construction').add(HttpApiGroup.make('records').add(...endpoints))
        const httpHandlers: Record<
          `read-${number}`,
          (request: { payload: typeof Payload.Type }) => Effect.Effect<number>
        > = Object.fromEntries(
          endpoints.map((current) => [
            current.identifier,
            ({ payload }: { payload: typeof Payload.Type }) => Effect.succeed(payload.id),
          ]),
        )
        const httpClient = yield* HttpApiTest.groups(api, ['records']).pipe(
          Effect.provide(
            Layer.mergeAll(
              HttpApiBuilder.group(api, 'records', (handlers) => handlers.handleAll(httpHandlers)),
              HttpServer.layerServices,
            ),
          ),
        )
        const httpFactory = () =>
          createHttpApiQueryUtils(api, {
            client: httpClient,
            keyPrefix: ['construction', 'owner-a'],
          })
        const http = httpFactory()
        equal(Object.isFrozen(http), true)
        equal(Object.isFrozen(http.records), true)
        equal(Object.keys(http.records).length, operationCount + 1)
        equal(Object.isFrozen(http.records['read-0']), true)
        measure(clock, 'http', 'factory', operationCount, 0, 50, httpFactory)

        if (operationCount !== 1) continue
        const custom = createRpcQueryUtils(group, {
          client: rpcClient,
          keyPrefix: ['construction', 'owner-a'],
          keyEncoders: { 'records.read-0': (value) => value },
        })
        const leaf = rpc.records['read-0']
        const customLeaf = custom.records['read-0']
        const httpLeaf = http.records['read-0']
        ok(leaf !== undefined)
        ok(customLeaf !== undefined)
        ok(httpLeaf !== undefined)
        for (const recordCount of records) {
          const value = input(recordCount)
          const normalized = Payload.make(value)
          const encode = Schema.encodeSync(Payload)
          const request = { params: { owner: 7 }, payload: normalized }
          const queryKey = leaf.queryKey(value)
          const httpKey: readonly JsonValue[] = httpLeaf.queryKey(request)
          deepStrictEqual(httpKey.slice(0, 7), [
            'construction',
            'owner-a',
            'http',
            'construction',
            'records',
            'read-0',
            'query',
          ])
          equal(Object.isFrozen(httpKey), true)
          equal(Object.isFrozen(httpKey.at(-1)), true)
          deepStrictEqual(queryKey, customLeaf.queryKey(value))
          deepStrictEqual(queryKey.slice(0, 6), [
            'construction',
            'owner-a',
            'rpc',
            'records',
            'read-0',
            'query',
          ])
          equal(Object.isFrozen(leaf.queryOptions({ input: value, staleTime: 1000 })), false)
          equal(Object.isFrozen(queryKey), true)
          equal(Object.isFrozen(queryKey.at(-1)), true)
          equal(Object.isFrozen(value), false)
          equal(Object.isFrozen(value.rows), false)
          measure(clock, 'rpc', 'payload-construction', 1, recordCount, 500, () =>
            Payload.make(value),
          )
          measure(clock, 'rpc', 'schema-encoding', 1, recordCount, 500, () => encode(normalized))
          measure(clock, 'rpc', 'query-key', 1, recordCount, 500, () => leaf.queryKey(value))
          measure(clock, 'rpc', 'query-key-custom-encoder', 1, recordCount, 500, () =>
            customLeaf.queryKey(value),
          )
          measure(clock, 'rpc', 'query-options', 1, recordCount, 500, () =>
            leaf.queryOptions({ input: value }),
          )
          measure(clock, 'http', 'query-key', 1, recordCount, 500, () => httpLeaf.queryKey(request))
          measure(clock, 'http', 'query-options', 1, recordCount, 500, () =>
            httpLeaf.queryOptions({ input: request }),
          )
        }
        const queryClient = new QueryClient()
        try {
          const first = leaf.queryOptions({ input: { id: 41, rows: [] } })
          const second = leaf.queryOptions({ input: { id: 42, rows: [] } })
          deepStrictEqual(
            yield* Effect.promise(() =>
              Promise.all([queryClient.query(first), queryClient.query(second)]),
            ),
            [41, 42],
          )
          equal(queryClient.getQueryData(first.queryKey), 41)
          equal(queryClient.getQueryData(second.queryKey), 42)
          const otherOwner = createRpcQueryUtils(group, {
            client: rpcClient,
            keyPrefix: ['construction', 'owner-b'],
          })
          const otherLeaf = otherOwner.records['read-0']
          ok(otherLeaf !== undefined)
          equal(queryClient.getQueryData(otherLeaf.queryKey({ id: 41, rows: [] })), undefined)
          equal(
            yield* Effect.promise(() =>
              queryClient.query(
                httpLeaf.queryOptions({
                  input: { params: { owner: 7 }, payload: { id: 43, locale: 'en', rows: [] } },
                }),
              ),
            ),
            43,
          )
          throws(() => leaf.queryKey({ id: 1.5, rows: [] }), EffectRpcQueryKeyError)
          const invalidGroup = RpcGroup.make(
            Rpc.make('records.key', { payload: Payload, success: Schema.Int }),
          )
          const invalidClient = yield* RpcTest.makeClient(invalidGroup, { flatten: true }).pipe(
            Effect.provide(invalidGroup.toLayer({ 'records.key': () => Effect.succeed(0) })),
          )
          throws(
            () =>
              createRpcQueryUtils(invalidGroup, {
                client: invalidClient,
                keyPrefix: ['construction'],
              }),
            EffectRpcQueryConfigError,
          )
        } finally {
          queryClient.clear()
        }
      }
    }),
  ),
)

console.log(JSON.stringify({ samples, warmupIterations: 20, measurements }))
