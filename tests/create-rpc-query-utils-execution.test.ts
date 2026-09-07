import { describe, expect, it } from '@effect/vitest'
import {
  CancelledError,
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/query-core'
import { Context, Deferred, Effect, Equal, Exit, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'

import {
  createRpcQueryUtils,
  EffectRpcQueryError,
  EffectRpcQueryKeyError,
  isEffectRpcQueryError,
  type RunPromiseExit,
} from '#effect-api-query'

import { group, makeClient, makeRpcTestClient } from './fixtures/effect-rpc'

describe('createRpcQueryUtils execution boundaries', () => {
  it.effect('executes and advances infinite queries through Query Core', () =>
    Effect.gen(function* () {
      const ListPage = Rpc.make('pages.list', {
        payload: {
          cursor: Schema.Int,
          pageSize: Schema.Int.pipe(
            Schema.optionalKey,
            Schema.withConstructorDefault(Effect.succeed(2)),
          ),
        },
        success: Schema.Struct({
          cursor: Schema.Int,
          nextCursor: Schema.NullOr(Schema.Int),
          values: Schema.Array(Schema.Int),
        }),
      })
      const pagesGroup = RpcGroup.make(ListPage)
      const executedCursors: Array<number> = []
      const client = yield* makeRpcTestClient(pagesGroup, {
        'pages.list': Effect.fn('TestRpc.pages.list')(({ cursor, pageSize }) =>
          Effect.sync(() => {
            executedCursors.push(cursor)
            return {
              cursor,
              nextCursor: cursor < 2 ? cursor + 1 : null,
              values: Array.from({ length: pageSize }, (_, index) => cursor * pageSize + index),
            }
          }),
        ),
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(pagesGroup, {
        client,
        keyPrefix: ['app'] as const,
      })
      const options = utils.pages.list.infiniteOptions({
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        initialPageParam: 0,
        input: (cursor) => ({ cursor }),
        meta: { source: 'infinite-test' },
        staleTime: Number.POSITIVE_INFINITY,
      })

      const first = yield* Effect.promise(() => queryClient.infiniteQuery(options))
      expect(first).toEqual({
        pageParams: [0],
        pages: [{ cursor: 0, nextCursor: 1, values: [0, 1] }],
      })
      expect(options.queryKey).toEqual(utils.pages.list.infiniteKey({ cursor: 0 }))
      expect(options.meta).toEqual({ source: 'infinite-test' })

      const observer = new InfiniteQueryObserver(queryClient, options)
      const second = yield* Effect.promise(() => observer.fetchNextPage())
      expect(second.data).toEqual({
        pageParams: [0, 1],
        pages: [
          { cursor: 0, nextCursor: 1, values: [0, 1] },
          { cursor: 1, nextCursor: 2, values: [2, 3] },
        ],
      })
      expect(queryClient.getQueryData(options.queryKey)).toEqual(second.data)

      yield* Effect.promise(() =>
        queryClient.invalidateQueries({ queryKey: utils.pages.list.infiniteKey({ cursor: 0 }) }),
      )
      yield* Effect.promise(() => queryClient.refetchQueries({ queryKey: options.queryKey }))
      yield* Effect.promise(() => new QueryClient().infiniteQuery(options))
      expect(executedCursors).toEqual([0, 1, 0, 1, 0])
    }),
  )

  it.effect('executes mutation variables without invalidating cached queries', () =>
    Effect.gen(function* () {
      const Read = Rpc.make('counter.read', { success: Schema.Finite })
      const Set = Rpc.make('counter.set', {
        payload: { value: Schema.Finite },
        success: Schema.Finite,
      })
      const counterGroup = RpcGroup.make(Read, Set)
      let value = 0
      const client = yield* makeRpcTestClient(counterGroup, {
        'counter.read': Effect.fn('TestRpc.counter.read')(() => Effect.sync(() => value)),
        'counter.set': Effect.fn('TestRpc.counter.set')(
          ({ value: nextValue }: { readonly value: number }) =>
            Effect.sync(() => {
              value = nextValue
              return value
            }),
        ),
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(counterGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const readOptions = utils.counter.read.queryOptions({
        staleTime: Number.POSITIVE_INFINITY,
      })
      expect(yield* Effect.promise(() => queryClient.query(readOptions))).toBe(0)

      const firstOptions = utils.counter.set.mutationOptions({ gcTime: 60_000 })
      const secondOptions = utils.counter.set.mutationOptions({ gcTime: 60_000 })
      expect(firstOptions).not.toBe(secondOptions)
      expect(Object.isFrozen(firstOptions)).toBe(false)
      expect(Object.keys(firstOptions).sort()).toEqual(['gcTime', 'mutationFn', 'mutationKey'])
      expect(firstOptions.mutationKey).toBe(utils.counter.set.mutationKey())
      expect(firstOptions.mutationKey).toEqual(['app', 'rpc', 'counter', 'set', 'mutation'])

      const mutation = new MutationObserver(queryClient, firstOptions)
      expect(yield* Effect.promise(() => mutation.mutate({ value: 2 }))).toBe(2)
      expect(value).toBe(2)
      expect(yield* Effect.promise(() => queryClient.query(readOptions))).toBe(0)
    }),
  )

  it.effect('uses an injected runner for mutation Effects with residual services', () =>
    Effect.gen(function* () {
      class MutationEncodingService extends Context.Service<
        MutationEncodingService,
        { readonly suffix: string }
      >()('effect-api-query/tests/MutationEncodingService') {}
      const Payload = Schema.Struct({ value: Schema.String }).pipe(
        Schema.middlewareEncoding((encoding) =>
          Effect.flatMap(MutationEncodingService, () => encoding),
        ),
      )
      const Update = Rpc.make('encoding.update', {
        payload: Payload,
        success: Schema.String,
      })
      const encodingGroup = RpcGroup.make(Update)
      const client = yield* makeRpcTestClient(encodingGroup, {
        'encoding.update': Effect.fn('TestRpc.encoding.update')(({ value }) =>
          Effect.succeed(value),
        ),
      })
      let runnerUsed = false
      const runPromiseExit: RunPromiseExit<MutationEncodingService> = (effect, options) => {
        runnerUsed = true
        return Effect.runPromiseExit(
          Effect.provideService(effect, MutationEncodingService, { suffix: 'provided' }),
          options,
        )
      }
      const utils = createRpcQueryUtils(encodingGroup, {
        client,
        keyEncoders: {
          'encoding.update': (payload) => payload,
        },
        keyPrefix: ['app'] as const,
        runPromiseExit,
      })

      const mutation = new MutationObserver(
        new QueryClient(),
        utils.encoding.update.mutationOptions(),
      )
      expect(yield* Effect.promise(() => mutation.mutate({ value: 'updated' }))).toBe('updated')
      expect(runnerUsed).toBe(true)
    }),
  )

  it.effect('executes with the default runner and reuses query-stable cached data', () =>
    Effect.gen(function* () {
      const ReadProfile = Rpc.make('profiles.read', {
        payload: {
          id: Schema.Finite,
          locale: Schema.String.pipe(
            Schema.optionalKey,
            Schema.withConstructorDefault(Effect.succeed('en')),
          ),
        },
        success: Schema.Struct({
          id: Schema.Finite,
          locale: Schema.String,
          source: Schema.String,
        }),
      })
      const profileGroup = RpcGroup.make(ReadProfile)
      let source = 'first execution'
      const client = yield* makeRpcTestClient(profileGroup, {
        'profiles.read': Effect.fn('TestRpc.profiles.read')(
          (payload: { readonly id: number; readonly locale?: string }) =>
            Effect.sync(() => {
              const response = { id: payload.id, locale: payload.locale ?? 'en', source }
              source = 'second execution'
              return response
            }),
        ),
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(profileGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const firstOptions = utils.profiles.read.queryOptions({
        input: { id: 1 },
        staleTime: Number.POSITIVE_INFINITY,
      })
      const secondOptions = utils.profiles.read.queryOptions({
        input: { id: 1, locale: 'en' },
        staleTime: Number.POSITIVE_INFINITY,
      })

      expect(firstOptions).not.toBe(secondOptions)
      expect(Object.isFrozen(firstOptions)).toBe(false)
      expect(firstOptions.queryKey).toEqual(secondOptions.queryKey)
      expect(firstOptions.queryKey.at(-1)).toEqual({ id: 1, locale: 'en' })

      const first = yield* Effect.promise(() => queryClient.query(firstOptions))
      const cached = yield* Effect.promise(() => queryClient.query(secondOptions))

      expect(first).toEqual({ id: 1, locale: 'en', source: 'first execution' })
      expect(cached).toEqual(first)
    }),
  )

  it.effect('normalizes only successful undefined query data and sets no Query policy', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })
      const options = utils.health.ping.queryOptions()

      expect(Object.keys(options).sort()).toEqual(['queryFn', 'queryKey', 'queryKeyHashFn'])
      expect(yield* Effect.promise(() => new QueryClient().query(options))).toBeNull()
    }),
  )

  it.effect('fails synchronous key preparation before Query Core can execute the RPC', () =>
    Effect.gen(function* () {
      const Invalid = Rpc.make('invalid.read', {
        payload: { value: Schema.String },
        success: Schema.String,
      })
      const invalidGroup = RpcGroup.make(Invalid)
      const client = yield* makeRpcTestClient(invalidGroup, {
        'invalid.read': Effect.fn('TestRpc.invalid.read')(function* () {
          return yield* Effect.die(new Error('RPC executed before key preparation completed'))
        }),
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(invalidGroup, {
        client,
        keyPrefix: ['app'] as const,
      })
      const invalidInput = { value: 42 } as unknown as { readonly value: string }

      expect(() =>
        queryClient.query(utils.invalid.read.queryOptions({ input: invalidInput })),
      ).toThrow(
        expect.objectContaining<Partial<EffectRpcQueryKeyError>>({
          code: 'PayloadConstructionFailed',
          rpcTag: 'invalid.read',
        }),
      )
    }),
  )

  it.effect('interrupts default Effect execution when Query Core cancels', () =>
    Effect.gen(function* () {
      const Slow = Rpc.make('diagnostics.slow', { success: Schema.String })
      const slowGroup = RpcGroup.make(Slow)
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const client = yield* makeRpcTestClient(slowGroup, {
        'diagnostics.slow': Effect.fn('TestRpc.diagnostics.slow')(
          function* () {
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never
          },
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)),
        ),
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(slowGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const query = queryClient.query(utils.diagnostics.slow.queryOptions())
      yield* Deferred.await(started)
      yield* Effect.promise(() =>
        queryClient.cancelQueries({ queryKey: utils.diagnostics.slow.key() }),
      )
      yield* Deferred.await(interrupted)
      yield* Effect.promise(() => expect(query).rejects.toBeInstanceOf(CancelledError))
    }),
  )

  it.effect('interrupts infinite page execution when Query Core cancels', () =>
    Effect.gen(function* () {
      const SlowPage = Rpc.make('diagnostics.slow-page', {
        payload: { cursor: Schema.Int },
        success: Schema.String,
      })
      const slowGroup = RpcGroup.make(SlowPage)
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const client = yield* makeRpcTestClient(slowGroup, {
        'diagnostics.slow-page': Effect.fn('TestRpc.diagnostics.slow-page')(
          function* () {
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never
          },
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)),
        ),
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(slowGroup, {
        client,
        keyPrefix: ['app'] as const,
      })
      const options = utils.diagnostics['slow-page'].infiniteOptions({
        getNextPageParam: () => undefined,
        initialPageParam: 0,
        input: (cursor: number) => ({ cursor }),
      })

      const query = queryClient.infiniteQuery(options)
      yield* Deferred.await(started)
      yield* Effect.promise(() => queryClient.cancelQueries({ queryKey: options.queryKey }))
      yield* Deferred.await(interrupted)
      yield* Effect.promise(() => expect(query).rejects.toBeInstanceOf(CancelledError))
    }),
  )

  it.effect('passes user callback errors through untouched', () =>
    Effect.gen(function* () {
      const callbackError = new Error('select failed')
      const client = yield* makeClient()
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })
      const observer = new QueryObserver(
        queryClient,
        utils.users.get.queryOptions({
          input: { id: 1 },
          select: () => {
            throw callbackError
          },
        }),
      )

      const observedError = yield* Effect.promise(
        () =>
          new Promise<unknown>((resolve) => {
            const unsubscribe = observer.subscribe((result) => {
              if (result.isError) {
                unsubscribe()
                resolve(result.error)
              }
            })
          }),
      )

      expect(observedError).toBe(callbackError)
    }),
  )

  it.effect('wraps failed Exits without changing their Cause', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const directExit = yield* Effect.exit(client('diagnostics.fail', undefined))
      if (Exit.isSuccess(directExit)) {
        throw new Error('Expected the direct RPC client call to fail')
      }
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })

      const error = yield* Effect.promise(() =>
        new QueryClient()
          .query(utils.diagnostics.fail.queryOptions())
          .catch((value: unknown) => value),
      )

      expect(error).toBeInstanceOf(EffectRpcQueryError)
      expect(isEffectRpcQueryError(error)).toBe(true)
      expect(error).toMatchObject({
        _tag: 'EffectRpcQueryError',
        operation: 'query',
        rpcTag: 'diagnostics.fail',
      })
      expect(Equal.equals((error as EffectRpcQueryError<unknown>).cause, directExit.cause)).toBe(
        true,
      )
      expect(isEffectRpcQueryError(new Error('other'))).toBe(false)
      expect(isEffectRpcQueryError({ _tag: 'EffectRpcQueryError' })).toBe(false)
    }),
  )

  it.effect('wraps failed mutation Exits without changing their Cause', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const directExit = yield* Effect.exit(client('diagnostics.fail', undefined))
      if (Exit.isSuccess(directExit)) {
        throw new Error('Expected the direct RPC client call to fail')
      }
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })

      const error = yield* Effect.promise(() =>
        new MutationObserver(queryClient, utils.diagnostics.fail.mutationOptions())
          .mutate(undefined)
          .catch((value: unknown) => value),
      )

      expect(error).toMatchObject({
        _tag: 'EffectRpcQueryError',
        operation: 'mutation',
        rpcTag: 'diagnostics.fail',
      })
      expect(Equal.equals((error as EffectRpcQueryError<unknown>).cause, directExit.cause)).toBe(
        true,
      )
    }),
  )

  it.effect('preserves declared-failure and defect Causes from infinite pages', () =>
    Effect.gen(function* () {
      const Declared = Rpc.make('pages.declared', {
        success: Schema.String,
        error: Schema.Literal('declared-failure'),
      })
      const Defect = Rpc.make('pages.defect', { success: Schema.String })
      const failureGroup = RpcGroup.make(Declared, Defect)
      const defect = new Error('page defect')
      const client = yield* makeRpcTestClient(failureGroup, {
        'pages.declared': () => Effect.fail('declared-failure' as const),
        'pages.defect': () => Effect.die(defect),
      })
      const utils = createRpcQueryUtils(failureGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const failures = [
        {
          directExit: yield* Effect.exit(client('pages.declared', undefined as never)),
          query: () =>
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
              .infiniteQuery(
                utils.pages.declared.infiniteOptions({
                  getNextPageParam: () => undefined,
                  initialPageParam: 0,
                }),
              )
              .catch((value: unknown) => value),
          tag: 'pages.declared',
        },
        {
          directExit: yield* Effect.exit(client('pages.defect', undefined as never)),
          query: () =>
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
              .infiniteQuery(
                utils.pages.defect.infiniteOptions({
                  getNextPageParam: () => undefined,
                  initialPageParam: 0,
                }),
              )
              .catch((value: unknown) => value),
          tag: 'pages.defect',
        },
      ] as const

      for (const { directExit, query, tag } of failures) {
        if (Exit.isSuccess(directExit)) {
          throw new Error(`Expected ${tag} to fail`)
        }
        const error = yield* Effect.promise(query)

        expect(error).toMatchObject({
          _tag: 'EffectRpcQueryError',
          operation: 'infinite',
          rpcTag: tag,
        })
        expect(Equal.equals((error as EffectRpcQueryError<unknown>).cause, directExit.cause)).toBe(
          true,
        )
      }
    }),
  )

  it.effect('defers mutation payload construction to Effect execution', () =>
    Effect.gen(function* () {
      const Update = Rpc.make('profiles.update', {
        payload: { name: Schema.String },
        success: Schema.String,
      })
      const updateGroup = RpcGroup.make(Update)
      const client = yield* makeRpcTestClient(updateGroup, {
        'profiles.update': Effect.fn('TestRpc.profiles.update')(({ name }) => Effect.succeed(name)),
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(updateGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const options = utils.profiles.update.mutationOptions()
      const invalidVariables = { name: 42 } as unknown as { readonly name: string }
      const directExit = yield* Effect.exit(client('profiles.update', invalidVariables))
      if (Exit.isSuccess(directExit)) {
        throw new Error('Expected invalid mutation variables to fail')
      }

      const error = yield* Effect.promise(() =>
        new MutationObserver(queryClient, options)
          .mutate(invalidVariables)
          .catch((value: unknown) => value),
      )

      expect(error).toBeInstanceOf(EffectRpcQueryError)
      expect(error).not.toBeInstanceOf(EffectRpcQueryKeyError)
      expect(error).toMatchObject({ operation: 'mutation', rpcTag: 'profiles.update' })
      expect(Equal.equals((error as EffectRpcQueryError<unknown>).cause, directExit.cause)).toBe(
        true,
      )
    }),
  )

  it.effect('does not retain raw query input in execution errors', () =>
    Effect.gen(function* () {
      const FailSecret = Rpc.make('secrets.fail', {
        payload: { secret: Schema.String },
        success: Schema.String,
        error: Schema.Literal('declared-failure'),
      })
      const secretGroup = RpcGroup.make(FailSecret)
      const client = yield* makeRpcTestClient(secretGroup, {
        'secrets.fail': Effect.fn('TestRpc.secrets.fail')(function* () {
          return yield* Effect.fail('declared-failure' as const)
        }),
      })
      const utils = createRpcQueryUtils(secretGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const error = yield* Effect.promise(() =>
        new QueryClient()
          .query(utils.secrets.fail.queryOptions({ input: { secret: 'do-not-retain' } }))
          .catch((value: unknown) => value),
      )

      expect(error).toBeInstanceOf(EffectRpcQueryError)
      expect(error).not.toHaveProperty('input')
      expect(error).not.toHaveProperty('payload')
      expect((error as Error).message).not.toContain('do-not-retain')
      expect(JSON.stringify(error)).not.toContain('do-not-retain')
    }),
  )

  it.effect('passes runner rejections through untouched', () =>
    Effect.gen(function* () {
      const rejection = new Error('runner rejected')
      const runPromiseExit: RunPromiseExit = () => Promise.reject(rejection)
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
        runPromiseExit,
      })

      yield* Effect.promise(() =>
        expect(new QueryClient().query(utils.health.ping.queryOptions())).rejects.toBe(rejection),
      )

      yield* Effect.promise(() =>
        expect(
          new MutationObserver(new QueryClient(), utils.health.ping.mutationOptions()).mutate(
            undefined,
          ),
        ).rejects.toBe(rejection),
      )
    }),
  )

  it.effect('passes mutation callback errors through untouched', () =>
    Effect.gen(function* () {
      const callbackError = new Error('onMutate failed')
      let executed = false
      const runPromiseExit: RunPromiseExit = async <A, E>(): Promise<Exit.Exit<A, E>> => {
        executed = true
        return Exit.succeed(undefined as A)
      }
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
        runPromiseExit,
      })
      const mutation = new MutationObserver(
        new QueryClient(),
        utils.users.get.mutationOptions({
          onMutate: () => {
            throw callbackError
          },
        }),
      )

      yield* Effect.promise(() => expect(mutation.mutate({ id: 1 })).rejects.toBe(callbackError))
      expect(executed).toBe(false)
    }),
  )

  it.effect('forwards query abort signals and gives mutations no signal', () =>
    Effect.gen(function* () {
      let querySignal: AbortSignal | undefined
      let mutationReceivedOptions: boolean | undefined
      const runPromiseExit: RunPromiseExit = async <A, E>(
        _effect: Effect.Effect<A, E>,
        options?: { readonly signal?: AbortSignal },
      ): Promise<Exit.Exit<A, E>> => {
        if (options?.signal !== undefined) {
          querySignal = options.signal
          return new Promise((resolve) => {
            options.signal?.addEventListener('abort', () => {
              resolve(Exit.succeed('cancelled' as A))
            })
          })
        }
        mutationReceivedOptions = options !== undefined
        return Exit.succeed(undefined as A)
      }
      const client = yield* makeClient()
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
        runPromiseExit,
      })

      const query = queryClient.query(utils.health.ping.queryOptions())
      yield* Effect.yieldNow
      yield* Effect.promise(() => queryClient.cancelQueries({ queryKey: utils.health.ping.key() }))
      yield* Effect.promise(() => query.catch(() => undefined))

      expect(querySignal?.aborted).toBe(true)

      const mutation = new MutationObserver(queryClient, utils.health.ping.mutationOptions())
      const mutationResult = yield* Effect.promise(() => mutation.mutate(undefined))
      expect(mutationResult).toBeUndefined()
      expect(mutationReceivedOptions).toBe(false)
    }),
  )
})
