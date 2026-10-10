import { NodeRuntime } from '@effect/platform-node'
import { Clock, Effect, Layer, Schema } from 'effect'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from 'effect/http-api'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'

import { createHttpApiQueryUtils, createRpcQueryUtils } from '#effect-api-query'

const Payload = Schema.Struct({
  id: Schema.Int,
  locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
  rows: Schema.Array(Schema.Struct({ id: Schema.Int, title: Schema.String })),
})
const program = Effect.gen(function* () {
  const clock = yield* Clock.Clock
  const measurements: {
    adapter: string
    stage: string
    operations: number
    records: number
    iterations: number
    milliseconds: number[]
  }[] = []
  const measure = (
    adapter: string,
    stage: string,
    operations: number,
    records: number,
    iterations: number,
    operation: () => void,
  ) => {
    for (let warmup = 0; warmup < 20; warmup += 1) {
      operation()
    }
    const milliseconds = Array.from({ length: 5 }, () => {
      const started = clock.monotonicTimeNanosUnsafe()
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        operation()
      }
      return Number(clock.monotonicTimeNanosUnsafe() - started) / 1_000_000
    })
    measurements.push({ adapter, stage, operations, records, iterations, milliseconds })
  }
  for (const operationCount of [1, 250]) {
    const rpcs = Array.from({ length: operationCount }, (_, index) =>
      Rpc.make(`read-${index}`, { payload: Payload, success: Schema.Int }),
    )
    const group = RpcGroup.make(...rpcs)
    const rpcClient = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
      Effect.provide(
        group.toLayer(
          Object.fromEntries(
            rpcs.map((rpc) => [rpc._tag, (value: typeof Payload.Type) => Effect.succeed(value.id)]),
          ),
        ),
      ),
    )
    const rpcFactory = () =>
      createRpcQueryUtils(group, { client: rpcClient, keyPrefix: ['construction'] })
    const endpoint = (index: number) =>
      HttpApiEndpoint.post(`read-${index}`, `/read-${index}`, {
        payload: Payload,
        success: Schema.Int,
      })
    const endpoints = [
      endpoint(0),
      ...Array.from({ length: operationCount - 1 }, (_, index) => endpoint(index + 1)),
    ] as const
    const api = HttpApi.make('construction').add(HttpApiGroup.make('records').add(...endpoints))
    const handlers: Record<
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
          HttpApiBuilder.group(api, 'records', (builder) => builder.handleAll(handlers)),
          HttpServer.layerServices,
        ),
      ),
    )
    const httpFactory = () =>
      createHttpApiQueryUtils(api, { client: httpClient, keyPrefix: ['construction'] })
    measure('rpc', 'factory', operationCount, 0, 50, () => {
      rpcFactory()
    })
    measure('http', 'factory', operationCount, 0, 50, () => {
      httpFactory()
    })
    if (operationCount !== 1) {
      continue
    }
    const rpc = rpcFactory()['read-0']
    const http = httpFactory().records['read-0']
    if (rpc === undefined || http === undefined) {
      throw new TypeError('Missing workload operation')
    }
    for (const records of [1, 100]) {
      const input = {
        id: 1,
        rows: Array.from({ length: records }, (_, id) => ({ id, title: `record-${id}` })),
      }
      const request = { payload: Payload.make(input) }
      measure('rpc', 'query-key', 1, records, 500, () => {
        rpc.queryKey(input)
      })
      measure('rpc', 'query-options', 1, records, 500, () => {
        rpc.queryOptions({ input })
      })
      measure('http', 'query-key', 1, records, 500, () => {
        http.queryKey(request)
      })
      measure('http', 'query-options', 1, records, 500, () => {
        http.queryOptions({ input: request })
      })
    }
  }
  console.log(JSON.stringify({ samples: 5, warmupIterations: 20, measurements }))
})
NodeRuntime.runMain(program.pipe(Effect.scoped))
