import { CancelledError, QueryClient } from '@tanstack/query-core'
import { Cause, Context, Deferred, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { Rpc, RpcClient, RpcGroup, RpcMiddleware } from 'effect/rpc'
import { describe, expect, it, vi } from 'vite-plus/test'

import { createRpcQueryUtils, isEffectRpcQueryError } from '#effect-api-query'

import { captureFailure } from './fixtures/async.ts'
import { makeServerLocalRpcClient } from './fixtures/server-local-rpc.ts'

describe('server-local ready-client construction', () => {
  it('executes a production decoded-message client without calling the network fetch boundary', async () => {
    const networkFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network disabled'))
    const scope = Scope.makeUnsafe()
    try {
      class Profile extends Schema.Class<Profile>('ServerLocalProfile')({
        name: Schema.String,
      }) {
        greeting(): string {
          return `Hello, ${this.name}`
        }
      }
      const Read = Rpc.make('profiles.read', {
        payload: {
          name: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('Ada'))),
        },
        success: Profile,
      })
      const group = RpcGroup.make(Read)
      const handlers = group.toLayer({
        'profiles.read': ({ name }) => Effect.succeed(new Profile({ name })),
      })
      const client = await Effect.runPromise(
        makeServerLocalRpcClient(group).pipe(Effect.provide(handlers), Scope.provide(scope)),
      )
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['local'] })
      const profile = await queryClient.query(utils.profiles.read.queryOptions({ input: {} }))
      expect(profile.greeting()).toBe('Hello, Ada')
      expect(networkFetch).not.toHaveBeenCalled()
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      networkFetch.mockRestore()
    }
  })

  it('isolates server-owned services and authenticated headers between concurrent local request scopes', async () => {
    class RequestOwner extends Context.Service<RequestOwner, { readonly name: string }>()(
      'effect-api-query/tests/ServerLocalRequestOwner',
    ) {}
    class Authorization extends RpcMiddleware.Service<Authorization>()(
      'effect-api-query/tests/ServerLocalAuthorization',
      { error: Schema.Literal('unauthorized') },
    ) {}
    const Read = Rpc.make('owner.read', { success: Schema.String }).middleware(Authorization)
    const group = RpcGroup.make(Read)
    const handlers = group.toLayer({
      'owner.read': Effect.fnUntraced(function* () {
        return (yield* RequestOwner).name
      }),
    })
    const authorization = Layer.effect(
      Authorization,
      Effect.gen(function* () {
        const owner = yield* RequestOwner
        return Authorization.of((effect, { headers }) =>
          headers['x-owner'] === owner.name ? effect : Effect.fail('unauthorized' as const),
        )
      }),
    )
    const firstScope = Scope.makeUnsafe()
    const secondScope = Scope.makeUnsafe()
    try {
      const first = await Effect.runPromise(
        makeServerLocalRpcClient(group).pipe(
          Effect.provide(Layer.mergeAll(handlers, authorization)),
          Effect.provideService(RequestOwner, { name: 'first-owner' }),
          Scope.provide(firstScope),
        ),
      )
      const second = await Effect.runPromise(
        makeServerLocalRpcClient(group).pipe(
          Effect.provide(Layer.mergeAll(handlers, authorization)),
          Effect.provideService(RequestOwner, { name: 'second-owner' }),
          Scope.provide(secondScope),
        ),
      )
      const firstQueryClient = new QueryClient()
      const secondQueryClient = new QueryClient()
      const firstUtils = createRpcQueryUtils(group, {
        client: first,
        keyPrefix: ['local', 'first-owner'],
        runPromiseExit: async (effect, options) =>
          Effect.runPromiseExit(
            RpcClient.withHeaders(effect, { 'x-owner': 'first-owner' }),
            options,
          ),
      })
      const secondUtils = createRpcQueryUtils(group, {
        client: second,
        keyPrefix: ['local', 'second-owner'],
        runPromiseExit: async (effect, options) =>
          Effect.runPromiseExit(
            RpcClient.withHeaders(effect, { 'x-owner': 'second-owner' }),
            options,
          ),
      })
      await expect(
        Promise.all([
          firstQueryClient.query(firstUtils.owner.read.queryOptions()),
          secondQueryClient.query(secondUtils.owner.read.queryOptions()),
        ]),
      ).resolves.toStrictEqual(['first-owner', 'second-owner'])
      expect(
        secondQueryClient.getQueryData(firstUtils.owner.read.queryOptions().queryKey),
      ).toBeUndefined()
      await expect(Effect.runPromise(Effect.flip(first('owner.read', undefined)))).resolves.toBe(
        'unauthorized',
      )
      await expect(
        Effect.runPromise(
          Effect.flip(first('owner.read', undefined, { headers: { 'x-owner': 'second-owner' } })),
        ),
      ).resolves.toBe('unauthorized')

      await Effect.runPromise(Scope.close(firstScope, Exit.void))
      const disposed = await Effect.runPromiseExit(
        first('owner.read', undefined, { headers: { 'x-owner': 'first-owner' } }),
      )
      expect(Exit.isFailure(disposed) && Cause.hasInterrupts(disposed.cause)).toBe(true)
      await expect(
        Effect.runPromise(
          second('owner.read', undefined, { headers: { 'x-owner': 'second-owner' } }),
        ),
      ).resolves.toBe('second-owner')
    } finally {
      await Promise.all([
        Effect.runPromise(Scope.close(firstScope, Exit.void)),
        Effect.runPromise(Scope.close(secondScope, Exit.void)),
      ])
    }
  })

  it('preserves complete declared failure, defect, and interruption Causes through the local ready client', async () => {
    const Fail = Rpc.make('diagnostics.fail', {
      success: Schema.String,
      error: Schema.Literal('declared-failure'),
    })
    const group = RpcGroup.make(Fail)
    const cause = Cause.combine(
      Cause.fail('declared-failure' as const),
      Cause.combine(Cause.die(new Error('local defect')), Cause.interrupt(123)),
    )
    let failureCause = cause
    const scope = Scope.makeUnsafe()
    try {
      const client = await Effect.runPromise(
        makeServerLocalRpcClient(group).pipe(
          Effect.provide(
            group.toLayer({ 'diagnostics.fail': () => Effect.failCause(failureCause) }),
          ),
          Scope.provide(scope),
        ),
      )
      const direct = await Effect.runPromiseExit(client('diagnostics.fail', undefined))
      if (Exit.isSuccess(direct)) {
        throw new Error('Expected the local client to fail')
      }
      expect(direct.cause.reasons.map((reason) => reason._tag)).toStrictEqual([
        'Fail',
        'Die',
        'Interrupt',
      ])
      expect(Cause.interruptors(direct.cause)).toStrictEqual(new Set([123]))
      let queryCause: Cause.Cause<unknown> | undefined
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['local'],
        runPromiseExit: async (effect, options) => {
          const exit = await Effect.runPromiseExit(effect, options)
          if (Exit.isFailure(exit)) {
            queryCause = exit.cause
          }
          return exit
        },
      })
      const error = await captureFailure(
        new QueryClient().query(utils.diagnostics.fail.queryOptions()),
      )
      if (!isEffectRpcQueryError(error)) {
        throw new Error('Expected a query execution error')
      }
      expect(queryCause).toBeDefined()
      expect(error.cause).toBe(queryCause)
      expect(
        error.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error),
      ).toStrictEqual(['declared-failure'])
      // The default server policy collapses fatal defects; the local recipe keeps all reasons.
      failureCause = Cause.combine(
        Cause.fail('declared-failure' as const),
        Cause.die('fatal defect'),
      )
      const fatal = await captureFailure(
        new QueryClient().query(utils.diagnostics.fail.queryOptions()),
      )
      if (!isEffectRpcQueryError(fatal)) {
        throw new Error('Expected the fatal local query to return its failed Exit')
      }
      expect(fatal.cause).toBe(queryCause)
      expect(fatal.cause.reasons.map((reason) => reason._tag)).toStrictEqual(['Fail', 'Die'])
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('delivers query cancellation to a local handler and releases its request-owned resource', async () => {
    const started = Deferred.makeUnsafe<undefined>()
    const released = Deferred.makeUnsafe<undefined>()
    const Wait = Rpc.make('diagnostics.wait', { success: Schema.String })
    const group = RpcGroup.make(Wait)
    const scope = Scope.makeUnsafe()
    try {
      const client = await Effect.runPromise(
        makeServerLocalRpcClient(group).pipe(
          Effect.provide(
            group.toLayer({
              'diagnostics.wait': Effect.fnUntraced(function* () {
                yield* Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
                  Deferred.succeed(released, undefined),
                )
                return yield* Effect.never
              }),
            }),
          ),
          Scope.provide(scope),
        ),
      )
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['local'] })
      const options = utils.diagnostics.wait.queryOptions()
      const failure = captureFailure(queryClient.query(options))
      await Effect.runPromise(Deferred.await(started))
      await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
      await expect(failure).resolves.toBeInstanceOf(CancelledError)
      await Effect.runPromise(Deferred.await(released))
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
})
