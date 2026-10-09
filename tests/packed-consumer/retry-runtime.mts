import { QueryClient } from '@tanstack/query-core'
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Predicate,
  Result,
  Schema,
  Scope,
  Stream,
} from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  EffectHttpApiQueryKeyError,
  EffectRpcQueryKeyError,
  isEffectHttpApiQueryError,
  isEffectRpcQueryError,
} from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpServer,
} from 'effect/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from 'effect/http-api'
import { Rpc, RpcClient, RpcClientError, RpcGroup, RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, ok, rejects, throws } from 'node:assert/strict'

import {
  AuthenticationRequired,
  httpReadOptions,
  NotFound,
  readApi,
  readGroup,
  RetryLater,
  rpcReadOptions,
} from './docs-retry.ts'

const domain = new NotFound({})
const authentication = new AuthenticationRequired({})
const retryLater = new RetryLater({ retryAfterMs: 0 })
const defect = new Error('read defect')
const terminalCauses: readonly Cause.Cause<NotFound | AuthenticationRequired | RetryLater>[] = [
  Cause.fail(domain),
  Cause.fail(authentication),
  Cause.die(defect),
  Cause.interrupt(42),
  Cause.combine(Cause.fail(retryLater), Cause.die(defect)),
  Cause.combine(Cause.fail(retryLater), Cause.interrupt(42)),
  Cause.combine(Cause.fail(retryLater), Cause.fail(authentication)),
]

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      let attempts = 0
      let failure = Cause.fail<NotFound | AuthenticationRequired | RetryLater>(retryLater)
      let successOnAttempt = Infinity
      const client = yield* RpcTest.makeClient(readGroup, { flatten: true }).pipe(
        Effect.provide(
          readGroup.toLayer({
            'profile.read': () =>
              Effect.suspend(() => {
                attempts += 1
                return attempts === successOnAttempt
                  ? Effect.succeed('profile')
                  : Effect.failCause(failure)
              }),
          }),
        ),
      )
      const options = rpcReadOptions(client)
      const queryClient = new QueryClient()
      try {
        for (const cause of terminalCauses) {
          failure = cause
          const direct = yield* Effect.exit(client('profile.read', undefined))
          ok(Exit.isFailure(direct))
          attempts = 0
          queryClient.clear()
          yield* Effect.promise(() =>
            rejects(queryClient.query(options), (error: unknown) => {
              ok(isEffectRpcQueryError(error))
              equal(attempts, 1)
              equal(Cause.hasDies(error.cause), Cause.hasDies(direct.cause))
              equal(Cause.hasInterrupts(error.cause), Cause.hasInterrupts(direct.cause))
              const actual = Cause.findError(error.cause)
              const expected = Cause.findError(direct.cause)
              equal(Result.isSuccess(actual), Result.isSuccess(expected))
              if (Result.isSuccess(actual) && Result.isSuccess(expected)) {
                equal(actual.success, expected.success)
              }
              return true
            }),
          )
        }

        failure = Cause.fail(retryLater)
        attempts = 0
        queryClient.clear()
        yield* Effect.promise(() =>
          rejects(queryClient.query(options), (error: unknown) => {
            ok(isEffectRpcQueryError(error))
            equal(attempts, 3)
            equal(Cause.findError(error.cause)._tag, 'Success')
            return true
          }),
        )

        attempts = 0
        successOnAttempt = 3
        queryClient.clear()
        const delayIndexes: number[] = []
        const result = yield* Effect.promise(() =>
          queryClient.query({
            ...options,
            retryDelay: (attemptIndex, error) => {
              delayIndexes.push(attemptIndex)
              ok(isEffectRpcQueryError(error))
              ok(typeof options.retryDelay === 'function')
              return options.retryDelay(attemptIndex, error)
            },
          }),
        )
        equal(result, 'profile')
        equal(attempts, 3)
        deepStrictEqual(delayIndexes, [0, 1])

        attempts = 0
        successOnAttempt = Infinity
        queryClient.clear()
        const rpc = createRpcQueryUtils(readGroup, { client, keyPrefix: ['defaults'] })
        yield* Effect.promise(() => rejects(queryClient.query(rpc.profile.read.queryOptions())))
        equal(attempts, 1)
      } finally {
        queryClient.clear()
      }

      const transportError = new RpcClientError.RpcClientError({
        reason: HttpClientError.HttpClientErrorSchema.fromHttpClientError(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request: HttpClientRequest.get('https://profiles.test/rpc'),
            }),
          }),
        ),
      })
      let sent = 0
      const transport = yield* RpcClient.makeNoSerialization(readGroup, {
        flatten: true,
        onFromClient: ({ message }) =>
          message._tag === 'Request'
            ? Effect.sync(() => {
                sent += 1
              }).pipe(Effect.andThen(Effect.fail(transportError)))
            : Effect.void,
      })
      const transportQueryClient = new QueryClient()
      try {
        yield* Effect.promise(() =>
          rejects(
            transportQueryClient.query(rpcReadOptions(transport.client)),
            (error: unknown) => {
              ok(isEffectRpcQueryError(error))
              const failure = Cause.findError(error.cause)
              ok(Result.isSuccess(failure))
              equal(failure.success, transportError)
              return true
            },
          ),
        )
        equal(sent, 3)
      } finally {
        transportQueryClient.clear()
      }

      for (const error of [domain, authentication, retryLater]) {
        const expectedTag = error._tag
        let httpAttempts = 0
        const httpClient = yield* HttpApiTest.groups(readApi, ['profile']).pipe(
          Effect.provide(
            HttpApiBuilder.group(readApi, 'profile', (handlers) =>
              handlers.handle('read', () =>
                Effect.suspend(() => {
                  httpAttempts += 1
                  return httpAttempts === 3 ? Effect.succeed('profile') : Effect.fail(error)
                }),
              ),
            ),
          ),
        )
        const queryClient = new QueryClient()
        try {
          const query = queryClient.query(httpReadOptions(httpClient))
          if (error._tag === 'RetryLater') {
            equal(yield* Effect.promise(() => query), 'profile')
            equal(httpAttempts, 3)
          } else {
            yield* Effect.promise(() =>
              rejects(query, (error: unknown) => {
                ok(isEffectHttpApiQueryError(error))
                const failure = Cause.findError(error.cause)
                ok(Result.isSuccess(failure))
                ok(Predicate.isTagged(failure.success, expectedTag))
                return true
              }),
            )
            equal(httpAttempts, 1)
          }
        } finally {
          queryClient.clear()
        }
      }
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

let transportAttempts = 0
const httpClient = await Effect.runPromise(
  HttpApiClient.makeWith(readApi, {
    baseUrl: 'https://profiles.test',
    httpClient: HttpClient.make((request) =>
      Effect.suspend(() => {
        transportAttempts += 1
        return transportAttempts === 3
          ? Effect.succeed(HttpClientResponse.fromWeb(request, Response.json('profile')))
          : Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({ request }),
              }),
            )
      }),
    ),
  }),
)
const queryClient = new QueryClient()
try {
  const httpOptions = httpReadOptions(httpClient)
  const delays: number[] = []
  equal(
    await queryClient.query({
      ...httpOptions,
      retryDelay: (attempt, error) => {
        ok(isEffectHttpApiQueryError(error))
        ok(typeof httpOptions.retryDelay === 'function')
        delays.push(httpOptions.retryDelay(attempt, error))
        return 0
      },
    }),
    'profile',
  )
  equal(transportAttempts, 3)
  deepStrictEqual(delays, [1_000, 2_000])

  for (const adapter of ['rpc', 'http'] as const) {
    const scope = Scope.makeUnsafe()
    const rejection = new Error(`${adapter} runner rejected`)
    let runnerAttempts = 0
    const runPromiseExit: RunPromiseExit = async () => {
      runnerAttempts += 1
      return await Promise.reject(rejection)
    }
    try {
      let query: Promise<string>
      if (adapter === 'rpc') {
        const client = await Effect.runPromise(
          RpcTest.makeClient(readGroup, { flatten: true }).pipe(
            Effect.provide(readGroup.toLayer({ 'profile.read': () => Effect.succeed('profile') })),
            Scope.provide(scope),
          ),
        )
        const rpc = createRpcQueryUtils(readGroup, {
          client,
          keyPrefix: ['runner'],
          runPromiseExit,
        })
        const policy = rpcReadOptions(client)
        ok(typeof policy.retry === 'function')
        ok(typeof policy.retryDelay === 'function')
        query = queryClient.query(
          rpc.profile.read.queryOptions({ retry: policy.retry, retryDelay: policy.retryDelay }),
        )
      } else {
        const http = createHttpApiQueryUtils(readApi, {
          client: httpClient,
          keyPrefix: ['runner'],
          runPromiseExit,
        })
        const policy = httpReadOptions(httpClient)
        ok(typeof policy.retry === 'function')
        ok(typeof policy.retryDelay === 'function')
        query = queryClient.query(
          http.profile.read.queryOptions({ retry: policy.retry, retryDelay: policy.retryDelay }),
        )
      }
      await rejects(query, (error: unknown) => {
        equal(error, rejection)
        return true
      })
      equal(runnerAttempts, 1)
    } finally {
      await queryClient.cancelQueries()
      queryClient.clear()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  }

  const preparationFailure = new Error('key encoder rejected')
  const payloadApi = HttpApi.make('key-preparation').add(
    HttpApiGroup.make('profile').add(
      HttpApiEndpoint.get('read', '/profile/:id', {
        params: { id: Schema.String },
        success: Schema.String,
      }),
    ),
  )
  const payloadClient = await Effect.runPromise(
    HttpApiClient.makeWith(payloadApi, {
      baseUrl: 'https://profiles.test',
      httpClient: HttpClient.make((request) =>
        Effect.sync(() => {
          transportAttempts += 1
          return HttpClientResponse.fromWeb(request, Response.json('profile'))
        }),
      ),
    }),
  )
  const http = createHttpApiQueryUtils(payloadApi, {
    client: payloadClient,
    keyPrefix: ['preparation'],
    keyEncoders: {
      profile: {
        read: () => {
          throw preparationFailure
        },
      },
    },
  })
  throws(
    () => http.profile.read.queryOptions({ input: { params: { id: 'user' } }, retry: 2 }),
    (error: unknown) => {
      ok(error instanceof EffectHttpApiQueryKeyError)
      equal(error.cause, preparationFailure)
      return true
    },
  )
  equal(transportAttempts, 3)
  equal(queryClient.getQueryCache().getAll().length, 0)
  const payloadGroup = RpcGroup.make(
    Rpc.make('read', { payload: { id: Schema.String }, success: Schema.String }),
  )
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let executions = 0
        const client = yield* RpcTest.makeClient(payloadGroup, { flatten: true }).pipe(
          Effect.provide(
            payloadGroup.toLayer({ read: () => Effect.sync(() => String(++executions)) }),
          ),
        )
        const rpc = createRpcQueryUtils(payloadGroup, {
          client,
          keyPrefix: ['preparation'],
          keyEncoders: {
            read: () => {
              throw preparationFailure
            },
          },
        })
        throws(
          () => rpc.read.queryOptions({ input: { id: 'user' }, retry: 2 }),
          (error: unknown) => {
            ok(error instanceof EffectRpcQueryKeyError)
            equal(error.cause, preparationFailure)
            return true
          },
        )
        equal(executions, 0)
        equal(queryClient.getQueryCache().getAll().length, 0)
      }),
    ),
  )
} finally {
  queryClient.clear()
}

class StreamContext extends Context.Service<StreamContext, { readonly prefix: string }>()(
  'RetryRunner/StreamContext',
) {}

const StreamValue = Schema.String.pipe(
  Schema.middlewareDecoding((decoding) => Effect.flatMap(StreamContext, () => decoding)),
)
const watchGroup = RpcGroup.make(Rpc.make('events.watch', { success: StreamValue, stream: true }))
const wait = async (deferred: Deferred.Deferred<undefined>) =>
  await Effect.runPromise(Deferred.await(deferred).pipe(Effect.timeout('5 seconds')))

for (const operation of ['streamed', 'live'] as const) {
  const scope = Scope.makeUnsafe()
  const queryClient = new QueryClient()
  const events: string[] = []
  const published = Deferred.makeUnsafe<undefined>()
  const finalized = Deferred.makeUnsafe<undefined>()
  const serverFinalized = Deferred.makeUnsafe<undefined>()
  let signal: AbortSignal | undefined
  const readyClient = await Effect.runPromise(
    RpcTest.makeClient(watchGroup, { flatten: true }).pipe(
      Effect.provide(
        watchGroup.toLayer({
          'events.watch': () =>
            Stream.succeed('ready').pipe(
              Stream.concat(Stream.fromEffect(Effect.never)),
              Stream.ensuring(Deferred.succeed(serverFinalized, undefined).pipe(Effect.asVoid)),
            ),
        }),
      ),
      Scope.provide(scope),
    ),
  )
  await Effect.runPromise(
    Scope.addFinalizer(
      scope,
      Effect.sync(() => events.push('disposed')),
    ),
  )
  const client = ((
    tag: 'events.watch',
    input: void,
    options?: {
      readonly headers?: import('effect/http').Headers.Input | undefined
      readonly context?: Context.Context<never> | undefined
      readonly streamBufferSize?: number | undefined
    },
  ) =>
    readyClient(tag, input, options).pipe(
      Stream.mapEffect((value) =>
        Effect.map(StreamContext, ({ prefix }) => {
          events.push('consumed')
          return `${prefix}:${value}`
        }),
      ),
      Stream.ensuring(
        Effect.flatMap(StreamContext, ({ prefix }) =>
          Effect.sync(() => {
            events.push(`finalized:${prefix}`)
            Effect.runSync(Deferred.succeed(finalized, undefined))
          }),
        ),
      ),
    )) as typeof readyClient
  const runPromiseExit: RunPromiseExit<StreamContext> = async (effect, options) => {
    events.push('creation-started')
    signal = options?.signal
    const exit = await Effect.runPromiseExit(
      effect.pipe(Effect.provideService(StreamContext, { prefix: 'provided' })),
      options,
    )
    events.push('creation-completed')
    return exit
  }
  const utils = createRpcQueryUtils(watchGroup, {
    client,
    keyPrefix: ['runner-lifetime', operation],
    runPromiseExit,
  })
  const options =
    operation === 'live'
      ? utils.events.watch.liveOptions({ retry: false })
      : utils.events.watch.streamedOptions({ retry: false })
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    const data = queryClient.getQueryData(options.queryKey)
    if (data === 'provided:ready' || (Array.isArray(data) && data[0] === 'provided:ready')) {
      Effect.runSync(Deferred.succeed(published, undefined))
    }
  })
  const query =
    operation === 'live'
      ? queryClient.query(utils.events.watch.liveOptions({ retry: false }))
      : queryClient.query(utils.events.watch.streamedOptions({ retry: false }))
  const outcome = query.then(
    (data) => ({ _tag: 'Success', data }) as const,
    (error: unknown) => ({ _tag: 'Failure', error }) as const,
  )
  try {
    await wait(published)
    deepStrictEqual(events, ['creation-started', 'creation-completed', 'consumed'])
    equal(queryClient.getQueryState(options.queryKey)?.fetchStatus, 'fetching')
    await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
    await wait(finalized)
    await wait(serverFinalized)
    const result = await outcome
    ok(result._tag === 'Success')
    deepStrictEqual(result.data, operation === 'live' ? 'provided:ready' : ['provided:ready'])
    equal(queryClient.getQueryState(options.queryKey)?.fetchStatus, 'idle')
    equal(queryClient.getQueryState(options.queryKey)?.error, null)
    equal(signal?.aborted, true)
    deepStrictEqual(events, [
      'creation-started',
      'creation-completed',
      'consumed',
      'finalized:provided',
    ])
  } finally {
    unsubscribe()
    await queryClient.cancelQueries()
    await wait(finalized)
    queryClient.clear()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
  equal(events.at(-1), 'disposed')
}
