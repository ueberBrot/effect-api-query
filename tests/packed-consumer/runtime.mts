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
import { deepStrictEqual, equal, ok, rejects } from 'node:assert/strict'

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
