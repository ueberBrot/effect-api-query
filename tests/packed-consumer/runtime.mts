import { MutationObserver, QueryClient, QueryObserver, skipToken } from '@tanstack/query-core'
import { skipToken as reactQuerySkipToken } from '@tanstack/react-query'
import { Effect, Schema, Stream } from 'effect'
import * as rpcQuery from 'effect-api-query'
import type {
  CreateRpcQueryUtilsOptions,
  EffectRpcQueryConfigErrorCode,
  EffectRpcQueryKeyErrorCode,
  JsonValue,
  KeyEncoder,
  QueryData,
  RpcQueryUtils,
  RunPromiseExit,
  SkipToken,
} from 'effect-api-query'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
// fallow-ignore-file unused-file
// The packed-package verifier copies and executes this fixture in temporary consumers.
import { deepStrictEqual, equal, ok, rejects, throws } from 'node:assert/strict'

type PublicTypes = [
  CreateRpcQueryUtilsOptions<any, readonly [JsonValue, ...JsonValue[]]>,
  EffectRpcQueryConfigErrorCode,
  EffectRpcQueryKeyErrorCode,
  KeyEncoder<any>,
  QueryData<unknown>,
  RpcQueryUtils<any, readonly [JsonValue, ...JsonValue[]]>,
  RunPromiseExit,
  SkipToken,
]

const expectedExports = [
  'EffectHttpApiQueryConfigError',
  'EffectHttpApiQueryError',
  'EffectHttpApiQueryKeyError',
  'EffectRpcQueryConfigError',
  'EffectRpcQueryEmptyStreamError',
  'EffectRpcQueryError',
  'EffectRpcQueryKeyError',
  'createHttpApiQueryUtils',
  'createRpcQueryUtils',
  'isEffectHttpApiQueryError',
  'isEffectRpcQueryError',
  'skipToken',
] as const satisfies ReadonlyArray<keyof typeof rpcQuery>

if (JSON.stringify(Object.keys(rpcQuery).sort()) !== JSON.stringify(expectedExports)) {
  throw new Error('The package root exposed an unexpected runtime surface')
}
if (rpcQuery.skipToken !== skipToken || rpcQuery.skipToken !== reactQuerySkipToken) {
  throw new Error('The package returned a different skipToken instance')
}

const resolveFrom = import.meta.resolve as (specifier: string, parent?: string) => string
const packageEntry = resolveFrom('effect-api-query')
const consumerModules = new URL('./node_modules/', import.meta.url).href

for (const specifier of ['effect-api-query', 'effect', '@tanstack/query-core']) {
  ok(
    resolveFrom(specifier).startsWith(consumerModules),
    `${specifier} must resolve inside the isolated consumer`,
  )
}
for (const specifier of [
  '#effect-api-query',
  '#effect-api-query/core',
  'effect-api-query/core',
  'effect-api-query/rpc',
  'effect-api-query/http',
  'effect-api-query/src/index.ts',
  'effect-api-query/dist/index.mjs',
]) {
  await rejects(import(specifier), (error: unknown) => {
    ok(error instanceof Error && 'code' in error)
    equal(
      error.code,
      specifier.startsWith('#')
        ? 'ERR_PACKAGE_IMPORT_NOT_DEFINED'
        : 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    )
    return true
  })
}

equal(
  resolveFrom('@tanstack/query-core', packageEntry),
  resolveFrom('@tanstack/query-core'),
  'The package must resolve the consumer Query Core runtime',
)
equal(
  resolveFrom('effect', packageEntry),
  resolveFrom('effect'),
  'The package must resolve the consumer Effect runtime',
)

const Read = Rpc.make('compatibility.read', { success: Schema.String })
const Page = Rpc.make('compatibility.page', {
  payload: { cursor: Schema.Int },
  success: Schema.Int,
})
const Watch = Rpc.make('compatibility.watch', { success: Schema.String, stream: true })
const UndefinedWatch = Rpc.make('compatibility.undefined', {
  success: Schema.Undefined,
  stream: true,
})
const NullWatch = Rpc.make('compatibility.null', { success: Schema.Null, stream: true })
const OptionalWatch = Rpc.make('compatibility.optional', {
  success: Schema.UndefinedOr(Schema.String),
  stream: true,
})
const OpenWatch = Rpc.make('compatibility.open', { success: Schema.Undefined, stream: true })
const EmptyWatch = Rpc.make('compatibility.empty', { success: Schema.Undefined, stream: true })
const WriteUndefined = Rpc.make('compatibility.write', { success: Schema.Undefined })
const group = RpcGroup.make(
  Read,
  Page,
  Watch,
  UndefinedWatch,
  NullWatch,
  OptionalWatch,
  OpenWatch,
  EmptyWatch,
  WriteUndefined,
)
const handlers = group.of({
  'compatibility.empty': () => Stream.empty,
  'compatibility.null': () => Stream.succeed(null),
  'compatibility.open': () =>
    Stream.succeed(undefined).pipe(Stream.concat(Stream.fromEffect(Effect.never))),
  'compatibility.optional': () => Stream.make('value', undefined),
  'compatibility.page': Effect.fn('CompatibilityRpc.page')(({ cursor }) => Effect.succeed(cursor)),
  'compatibility.read': Effect.fn('CompatibilityRpc.read')(() => Effect.succeed('ordinary')),
  'compatibility.undefined': () => Stream.succeed(undefined),
  'compatibility.watch': () => Stream.make('first', 'second'),
  'compatibility.write': () => Effect.succeed(undefined),
})

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(group.toLayer(handlers)),
      )
      const queryClient = new QueryClient()
      const rpcUtilityTree = rpcQuery.createRpcQueryUtils(group, {
        client,
        keyPrefix: ['compatibility'] as const,
      })

      equal(
        yield* Effect.promise(() =>
          queryClient.query(rpcUtilityTree.compatibility.read.queryOptions()),
        ),
        'ordinary',
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.infiniteQuery(
            rpcUtilityTree.compatibility.page.infiniteOptions({
              getNextPageParam: () => undefined,
              initialPageParam: 0,
              input: (cursor) => ({ cursor }),
            }),
          ),
        ),
        { pageParams: [0], pages: [0] },
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.query(rpcUtilityTree.compatibility.watch.streamedOptions()),
        ),
        ['first', 'second'],
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(rpcUtilityTree.compatibility.watch.liveOptions()),
        ),
        'second',
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(rpcUtilityTree.compatibility.undefined.liveOptions()),
        ),
        null,
        'An undefined emission must become the live value',
      )
      equal(queryClient.getQueryData(rpcUtilityTree.compatibility.undefined.liveKey()), null)
      equal(
        yield* Effect.promise(() =>
          queryClient.query(rpcUtilityTree.compatibility.null.liveOptions()),
        ),
        null,
        'An explicit null emission must remain null',
      )
      equal(queryClient.getQueryData(rpcUtilityTree.compatibility.null.liveKey()), null)

      const optionalOptions = rpcUtilityTree.compatibility.optional.liveOptions()
      const latestValues: unknown[] = []
      const stopRecording = queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          event.action.type === 'success' &&
          event.query ===
            queryClient.getQueryCache().find({ queryKey: optionalOptions.queryKey, exact: true })
        ) {
          latestValues.push(event.query.state.data)
        }
      })
      try {
        equal(yield* Effect.promise(() => queryClient.query(optionalOptions)), null)
        deepStrictEqual(latestValues.slice(0, 2), ['value', null])
        equal(queryClient.getQueryData(optionalOptions.queryKey), null)
      } finally {
        stopRecording()
      }

      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.query(rpcUtilityTree.compatibility.undefined.streamedOptions()),
        ),
        [undefined],
        'Accumulated undefined elements must be preserved',
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.query(rpcUtilityTree.compatibility.optional.streamedOptions()),
        ),
        ['value', undefined],
      )
      const mutation = new MutationObserver(
        queryClient,
        rpcUtilityTree.compatibility.write.mutationOptions(),
      )
      equal(yield* Effect.promise(() => mutation.mutate(undefined)), undefined)

      yield* Effect.promise(() =>
        rejects(
          queryClient.query(rpcUtilityTree.compatibility.empty.liveOptions({ retry: false })),
          (error: unknown) => {
            ok(error instanceof rpcQuery.EffectRpcQueryEmptyStreamError)
            equal(error.rpcTag, 'compatibility.empty')
            return true
          },
        ),
      )
      equal(queryClient.getQueryData(rpcUtilityTree.compatibility.empty.liveKey()), undefined)

      const openOptions = rpcUtilityTree.compatibility.open.liveOptions({ retry: false })
      const observer = new QueryObserver(queryClient, openOptions)
      let unsubscribe = () => {}
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const firstSnapshot = yield* Effect.promise(
          () =>
            new Promise<{ readonly data: null; readonly fetchStatus: string }>(
              (resolve, reject) => {
                timeout = setTimeout(
                  () => reject(new Error('Live first emission timed out')),
                  10_000,
                )
                unsubscribe = observer.subscribe((result) => {
                  if (result.status === 'success') {
                    resolve(result)
                  } else if (result.status === 'error') {
                    reject(result.error)
                  }
                })
              },
            ),
        )
        equal(firstSnapshot.data, null)
        equal(firstSnapshot.fetchStatus, 'fetching')
        equal(queryClient.getQueryData(openOptions.queryKey), null)
      } finally {
        clearTimeout(timeout)
        unsubscribe()
        yield* Effect.promise(() => queryClient.cancelQueries({ queryKey: openOptions.queryKey }))
        observer.destroy()
        queryClient.clear()
      }
    }),
  ),
)

const BroadRead = Rpc.make('payload.unknown', { payload: Schema.Unknown, success: Schema.String })
const AnyRead = Rpc.make('payload.any', { payload: Schema.Any, success: Schema.String })
const OptionalRead = Rpc.make('payload.optional', {
  payload: Schema.Union([Schema.String, Schema.Void]),
  success: Schema.String,
})
const VoidRead = Rpc.make('payload.void', { payload: Schema.Void, success: Schema.String })
const DefaultRead = Rpc.make('payload.defaults', {
  payload: {
    id: Schema.Int,
    locale: Schema.String.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed('en')),
    ),
  },
  success: Schema.String,
})
const BroadWatch = Rpc.make('payload.unknownWatch', {
  payload: Schema.Unknown,
  success: Schema.String,
  stream: true,
})
const AnyWatch = Rpc.make('payload.anyWatch', {
  payload: Schema.Any,
  success: Schema.String,
  stream: true,
})
const BroadOptionalWatch = Rpc.make('payload.optionalWatch', {
  payload: Schema.Union([Schema.String, Schema.Void]),
  success: Schema.String,
  stream: true,
})
const VoidWatch = Rpc.make('payload.voidWatch', {
  payload: Schema.Void,
  success: Schema.String,
  stream: true,
})
const broadGroup = RpcGroup.make(
  BroadRead,
  AnyRead,
  OptionalRead,
  VoidRead,
  DefaultRead,
  BroadWatch,
  AnyWatch,
  BroadOptionalWatch,
  VoidWatch,
)
const broadHandlers = broadGroup.of({
  'payload.unknown': (input) => Effect.succeed(JSON.stringify(input)),
  'payload.any': (input) => Effect.succeed(String(input)),
  'payload.optional': (input) => Effect.succeed(input ?? 'empty'),
  'payload.void': () => Effect.succeed('payloadless'),
  'payload.defaults': ({ id, locale }) => Effect.succeed(`${id}:${locale}`),
  'payload.unknownWatch': (input) => Stream.make(JSON.stringify(input), 'unknown-last'),
  'payload.anyWatch': (input) => Stream.make(String(input), 'any-last'),
  'payload.optionalWatch': (input) => Stream.make(input ?? 'empty', 'optional-last'),
  'payload.voidWatch': () => Stream.make('payloadless-first', 'payloadless-last'),
})

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(broadGroup, { flatten: true }).pipe(
        Effect.provide(broadGroup.toLayer(broadHandlers)),
      )
      const queryClient = new QueryClient()
      const defaults = rpcQuery.createRpcQueryUtils(broadGroup, {
        client,
        keyPrefix: ['payload'],
      })
      const encoded = rpcQuery.createRpcQueryUtils(broadGroup, {
        client,
        keyPrefix: ['encoded'],
        keyEncoders: {
          'payload.unknown': (input) => (input === undefined ? 'empty' : String(input)),
          'payload.any': (input) => String(input),
          'payload.optional': (input) => input ?? null,
          'payload.unknownWatch': (input) => String(input),
          'payload.anyWatch': (input) => String(input),
          'payload.optionalWatch': (input) => input ?? null,
        },
      })

      deepStrictEqual(defaults.payload.unknown.queryKey({ id: 7 }), [
        'payload',
        'rpc',
        'payload',
        'unknown',
        'query',
        { id: 7 },
      ])
      deepStrictEqual(defaults.payload.any.queryKey(7), [
        'payload',
        'rpc',
        'payload',
        'any',
        'query',
        7,
      ])
      deepStrictEqual(defaults.payload.optional.queryKey('input'), [
        'payload',
        'rpc',
        'payload',
        'optional',
        'query',
        'input',
      ])
      for (const invalid of [undefined, 1n, new Date(0)]) {
        throws(() => defaults.payload.unknown.queryKey(invalid), rpcQuery.EffectRpcQueryKeyError)
        throws(() => defaults.payload.any.queryKey(invalid), rpcQuery.EffectRpcQueryKeyError)
      }
      throws(() => defaults.payload.optional.queryKey(undefined), rpcQuery.EffectRpcQueryKeyError)
      deepStrictEqual(encoded.payload.optional.queryKey(undefined), [
        'encoded',
        'rpc',
        'payload',
        'optional',
        'query',
        null,
      ])
      deepStrictEqual(
        defaults.payload.defaults.queryKey({ id: 7 }),
        defaults.payload.defaults.queryKey({ id: 7, locale: 'en' }),
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(defaults.payload.defaults.queryOptions({ input: { id: 7 } })),
        ),
        '7:en',
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(defaults.payload.unknown.queryOptions({ input: { id: 7 } })),
        ),
        '{"id":7}',
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(defaults.payload.any.queryOptions({ input: 7 })),
        ),
        '7',
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(encoded.payload.optional.queryOptions({ input: undefined })),
        ),
        'empty',
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(encoded.payload.any.queryOptions({ input: 1n })),
        ),
        '1',
      )
      equal(
        yield* Effect.promise(() =>
          new MutationObserver(queryClient, defaults.payload.unknown.mutationOptions()).mutate({
            id: 8,
          }),
        ),
        '{"id":8}',
      )
      equal(
        yield* Effect.promise(() =>
          new MutationObserver(queryClient, defaults.payload.any.mutationOptions()).mutate(2n),
        ),
        '2',
      )
      equal(
        yield* Effect.promise(() =>
          new MutationObserver(queryClient, defaults.payload.optional.mutationOptions()).mutate(
            undefined,
          ),
        ),
        'empty',
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.infiniteQuery(
            defaults.payload.unknown.infiniteOptions({
              input: (page: number) => ({ page }),
              initialPageParam: 0,
              getNextPageParam: () => undefined,
            }),
          ),
        ),
        { pages: ['{"page":0}'], pageParams: [0] },
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.infiniteQuery(
            defaults.payload.any.infiniteOptions({
              input: (page: number) => page,
              initialPageParam: 0,
              getNextPageParam: () => undefined,
            }),
          ),
        ),
        { pages: ['0'], pageParams: [0] },
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.infiniteQuery(
            encoded.payload.optional.infiniteOptions({
              input: () => undefined,
              initialPageParam: 0,
              getNextPageParam: () => undefined,
            }),
          ),
        ),
        { pages: ['empty'], pageParams: [0] },
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.query(defaults.payload.unknownWatch.streamedOptions({ input: { id: 7 } })),
        ),
        ['{"id":7}', 'unknown-last'],
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.query(defaults.payload.anyWatch.streamedOptions({ input: 7 })),
        ),
        ['7', 'any-last'],
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.query(encoded.payload.optionalWatch.streamedOptions({ input: undefined })),
        ),
        ['empty', 'optional-last'],
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(defaults.payload.unknownWatch.liveOptions({ input: { id: 7 } })),
        ),
        'unknown-last',
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(defaults.payload.anyWatch.liveOptions({ input: 7 })),
        ),
        'any-last',
      )
      equal(
        yield* Effect.promise(() =>
          queryClient.query(encoded.payload.optionalWatch.liveOptions({ input: undefined })),
        ),
        'optional-last',
      )
      equal(
        yield* Effect.promise(() => queryClient.query(defaults.payload.void.queryOptions())),
        'payloadless',
      )
      equal(
        yield* Effect.promise(() => defaults.payload.void.mutationOptions().mutationFn()),
        'payloadless',
      )
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.query(defaults.payload.voidWatch.streamedOptions()),
        ),
        ['payloadless-first', 'payloadless-last'],
      )
      equal(
        yield* Effect.promise(() => queryClient.query(defaults.payload.voidWatch.liveOptions())),
        'payloadless-last',
      )
    }),
  ),
)
