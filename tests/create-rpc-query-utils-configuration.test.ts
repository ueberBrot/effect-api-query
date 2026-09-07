import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Redacted, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import type { RpcClient } from 'effect/unstable/rpc'

import {
  createRpcQueryUtils,
  EffectRpcQueryConfigError,
  EffectRpcQueryKeyError,
  type CreateRpcQueryUtilsOptions,
  type JsonValue,
} from '#effect-api-query'

import { group, makeClient, makeRpcTestClient } from './fixtures/effect-rpc'

const unusedClient = Effect.fn('TestRpc.unusedClient')(function* () {
  return yield* Effect.die('configuration tests must not execute RPCs')
})

const unusedClientFor = <Group extends RpcGroup.Any>(_group: Group) =>
  unusedClient as unknown as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<Group>>

describe('createRpcQueryUtils configuration', () => {
  it('ignores inherited key encoders for allowed Object prototype names', () => {
    const rpcGroup = RpcGroup.make(
      Rpc.make('toString', {
        payload: { id: Schema.Number },
        success: Schema.String,
      }),
    )
    for (const keyEncoders of [undefined, {}, Object.create({ toString: () => 'shared' })]) {
      const utils = createRpcQueryUtils(rpcGroup, {
        client: unusedClientFor(rpcGroup),
        keyPrefix: ['app'],
        keyEncoders,
      })
      expect(utils.toString.queryKey({ id: 1 })).not.toEqual(utils.toString.queryKey({ id: 2 }))
    }
    const utils = createRpcQueryUtils(rpcGroup, {
      client: unusedClientFor(rpcGroup),
      keyPrefix: ['app'],
      keyEncoders: { toString: ({ id }) => id },
    })
    expect(utils.toString.queryKey({ id: 1 })).toEqual(['app', 'rpc', 'toString', 'query', 1])
  })

  it('does not accept an inherited encoder for redacted payloads', () => {
    const rpcGroup = RpcGroup.make(
      Rpc.make('toString', {
        payload: { secret: Schema.RedactedFromValue(Schema.String) },
        success: Schema.String,
      }),
    )
    expect(() =>
      createRpcQueryUtils(rpcGroup, {
        client: unusedClientFor(rpcGroup),
        keyPrefix: ['app'],
        keyEncoders: Object.create({ toString: () => 'safe' }),
      }),
    ).toThrow(expect.objectContaining({ code: 'MissingKeyEncoder' }))
  })

  it.effect('reports invalid utility paths with a stable configuration error', () =>
    Effect.gen(function* () {
      const InvalidPath = Rpc.make('invalid..path', { success: Schema.String })
      const invalidGroup = RpcGroup.make(InvalidPath)
      const client = yield* makeRpcTestClient(invalidGroup, {
        'invalid..path': () => Effect.succeed('ok'),
      })

      expect(() =>
        createRpcQueryUtils(invalidGroup, {
          client,
          keyPrefix: ['app'] as const,
        }),
      ).toThrow(
        expect.objectContaining<Partial<EffectRpcQueryConfigError>>({
          _tag: 'EffectRpcQueryConfigError',
          code: 'InvalidRpcPath',
          rpcTag: 'invalid..path',
        }),
      )
    }),
  )

  it.each([
    '',
    '.leading',
    'trailing.',
    'empty..segment',
    '__proto__.child',
    'prototype.child',
    'constructor.child',
    'namespace.infiniteKey',
    'namespace.infiniteOptions',
    'namespace.key',
    'namespace.liveKey',
    'namespace.liveOptions',
    'namespace.queryKey',
    'namespace.mutationKey',
    'namespace.queryOptions',
    'namespace.streamedKey',
    'namespace.streamedOptions',
    'namespace.mutationOptions',
  ])('rejects the invalid RPC path %j before returning a tree', (rpcTag) => {
    const invalidGroup = RpcGroup.make(Rpc.make(rpcTag, { success: Schema.Void }))

    expect(() =>
      createRpcQueryUtils(invalidGroup, {
        client: unusedClientFor(invalidGroup),
        keyPrefix: ['app'] as const,
      }),
    ).toThrow(
      expect.objectContaining<Partial<EffectRpcQueryConfigError>>({
        _tag: 'EffectRpcQueryConfigError',
        code: 'InvalidRpcPath',
        rpcTag,
      }),
    )
  })

  it('rejects every leaf-branch collision regardless of request order', () => {
    const Leaf = Rpc.make('users', { success: Schema.Void })
    const Descendant = Rpc.make('users.get', { success: Schema.Void })
    const groups = [
      [RpcGroup.make(Leaf, Descendant), 'users.get', 'users'],
      [RpcGroup.make(Descendant, Leaf), 'users', 'users.get'],
    ] as const

    for (const [collidingGroup, rpcTag, path] of groups) {
      expect(() =>
        createRpcQueryUtils(collidingGroup, {
          client: unusedClientFor(collidingGroup),
          keyPrefix: ['app'] as const,
        }),
      ).toThrow(
        expect.objectContaining<Partial<EffectRpcQueryConfigError>>({
          _tag: 'EffectRpcQueryConfigError',
          code: 'RpcPathCollision',
          path,
          rpcTag,
        }),
      )
    }
  })

  it('rejects duplicate projected paths retained under different request-map keys', () => {
    const First = Rpc.make('duplicates.read', { success: Schema.Literal('first') })
    const Duplicate = Rpc.make('duplicates.read', { success: Schema.Literal('second') })
    const duplicateGroup = RpcGroup.make(First)
    const requests = duplicateGroup.requests as unknown as Map<string, Rpc.Any>
    requests.set('duplicate-map-key', Duplicate)

    expect(() =>
      createRpcQueryUtils(duplicateGroup, {
        client: unusedClientFor(duplicateGroup),
        keyPrefix: ['app'] as const,
      }),
    ).toThrow(
      expect.objectContaining<Partial<EffectRpcQueryConfigError>>({
        _tag: 'EffectRpcQueryConfigError',
        code: 'RpcPathCollision',
        path: 'duplicates.read',
        rpcTag: 'duplicates.read',
      }),
    )
  })

  it('rejects key encoders for operations without payload keys before returning a tree', () => {
    const Payloadless = Rpc.make('health.ping', { success: Schema.Void })
    const Streaming = Rpc.make('events.watch', {
      success: Schema.String,
      stream: true,
    })
    const unsupportedGroup = RpcGroup.make(Payloadless, Streaming)
    type UnsupportedOptions = CreateRpcQueryUtilsOptions<typeof unsupportedGroup, readonly ['app']>
    let encoderExecutions = 0

    for (const rpcTag of ['health.ping', 'events.watch', 'unknown.read']) {
      const options = {
        client: unusedClientFor(unsupportedGroup),
        keyEncoders: {
          [rpcTag]: () => {
            encoderExecutions += 1
            return null
          },
        },
        keyPrefix: ['app'] as const,
      } as unknown as UnsupportedOptions

      expect(() => createRpcQueryUtils(unsupportedGroup, options)).toThrow(
        expect.objectContaining<Partial<EffectRpcQueryConfigError>>({
          _tag: 'EffectRpcQueryConfigError',
          code: 'UnknownKeyEncoder',
          rpcTag,
        }),
      )
    }
    expect(encoderExecutions).toBe(0)
  })

  it.effect('reports non-JSON encoder output with a stable key error', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyEncoders: {
          // The cast simulates an encoder that violates its declared JSON contract at runtime.
          'users.get': () => ({ invalid: undefined }) as unknown as JsonValue,
        },
        keyPrefix: ['app'] as const,
      })

      expect(() => utils.users.get.queryKey({ id: 1 })).toThrow(
        expect.objectContaining<Partial<EffectRpcQueryKeyError>>({
          _tag: 'EffectRpcQueryKeyError',
          code: 'InvalidKeyValue',
          rpcTag: 'users.get',
        }),
      )
    }),
  )

  it.effect('passes normalized payloads to optional key encoders', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      let receivedPayload: { readonly id: number; readonly locale?: string | undefined } | undefined
      const utils = createRpcQueryUtils(group, {
        client,
        keyEncoders: {
          'users.get': (payload) => {
            receivedPayload = payload
            return { id: payload.id, locale: payload.locale ?? 'en' }
          },
        },
        keyPrefix: ['app'] as const,
      })

      const key = utils.users.get.queryKey({ id: 1 })

      expect(receivedPayload).toEqual({ id: 1, locale: 'en' })
      expect(key).toEqual(['app', 'rpc', 'users', 'get', 'query', { id: 1, locale: 'en' }])
      expect(Object.isFrozen(key.at(-1))).toBe(true)
    }),
  )

  it.effect('wraps thrown key encoder failures without retaining input', () =>
    Effect.gen(function* () {
      const encoderFailure = new Error('encoder failed')
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyEncoders: {
          'users.get': () => {
            throw encoderFailure
          },
        },
        keyPrefix: ['app'] as const,
      })

      const error = captureKeyError(() =>
        utils.users.get.queryKey({ id: 1, locale: 'do-not-retain' }),
      )

      expect(error).toMatchObject({
        _tag: 'EffectRpcQueryKeyError',
        code: 'KeyEncoderFailed',
        rpcTag: 'users.get',
      })
      expect(error.cause).toBe(encoderFailure)
      expect(error.message).not.toContain('do-not-retain')
      expect(error).not.toHaveProperty('encoded')
      expect(error).not.toHaveProperty('input')
      expect(error).not.toHaveProperty('payload')
      expect(error).not.toHaveProperty('value')
    }),
  )

  it.effect('requires a custom key encoder for explicitly redacted payloads', () =>
    Effect.gen(function* () {
      const Secret = Rpc.make('secrets.read', {
        payload: { secret: Schema.Redacted(Schema.String) },
        success: Schema.String,
      })
      const secretGroup = RpcGroup.make(Secret)
      type SecretOptions = CreateRpcQueryUtilsOptions<typeof secretGroup, readonly ['app']>
      const client = yield* makeRpcTestClient(secretGroup, {
        'secrets.read': () => Effect.succeed('ok'),
      })
      const unsafeOptions = {
        client,
        keyPrefix: ['app'] as const,
      } as unknown as SecretOptions

      expect(() => createRpcQueryUtils(secretGroup, unsafeOptions)).toThrow(
        expect.objectContaining<Partial<EffectRpcQueryConfigError>>({
          _tag: 'EffectRpcQueryConfigError',
          code: 'MissingKeyEncoder',
          rpcTag: 'secrets.read',
        }),
      )

      let receivedRedacted = false
      const utils = createRpcQueryUtils(secretGroup, {
        client,
        keyEncoders: {
          'secrets.read': (payload) => {
            receivedRedacted = Redacted.isRedacted(payload.secret)
            return { subject: 'current-user' }
          },
        },
        keyPrefix: ['app'] as const,
      })
      const key = utils.secrets.read.queryKey({ secret: Redacted.make('do-not-key') })

      expect(receivedRedacted).toBe(true)
      expect(key).toEqual(['app', 'rpc', 'secrets', 'read', 'query', { subject: 'current-user' }])
      expect(JSON.stringify(key)).not.toContain('do-not-key')
    }),
  )

  it('requires safe encoders for suspended redacted schemas and encoding middleware', () => {
    const Secret = Schema.suspend(() => Schema.RedactedFromValue(Schema.String))
    const Encoded = Schema.suspend(() =>
      Schema.String.pipe(Schema.middlewareEncoding((encoding) => encoding)),
    )
    for (const payload of [Secret, Schema.Struct({ nested: Schema.Array(Secret) }), Encoded]) {
      const rpcGroup = RpcGroup.make(Rpc.make('read', { payload, success: Schema.String }))
      type Options = CreateRpcQueryUtilsOptions<typeof rpcGroup, readonly ['app']>
      const options = {
        client: unusedClientFor(rpcGroup),
        keyPrefix: ['app'],
      } as unknown as Options
      expect(() => createRpcQueryUtils(rpcGroup, options)).toThrow(
        expect.objectContaining({ code: 'MissingKeyEncoder' }),
      )
      expect(() =>
        createRpcQueryUtils(rpcGroup, {
          ...options,
          keyEncoders: { read: () => 'safe-identity' },
        } as unknown as Options),
      ).not.toThrow()
    }
  })

  it('keeps ordinary recursive schemas usable', () => {
    interface Tree {
      readonly name: string
      readonly children: readonly Tree[]
    }
    const Tree = Schema.Struct({
      name: Schema.String,
      children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree)),
    })
    const rpcGroup = RpcGroup.make(Rpc.make('read', { payload: Tree, success: Schema.String }))
    const utils = createRpcQueryUtils(rpcGroup, {
      client: unusedClientFor(rpcGroup),
      keyPrefix: ['app'],
    })
    expect(
      utils.read.queryKey({ name: 'root', children: [{ name: 'leaf', children: [] }] }),
    ).toEqual([
      'app',
      'rpc',
      'read',
      'query',
      { name: 'root', children: [{ name: 'leaf', children: [] }] },
    ])
  })

  it.effect('requires a custom key encoder for Schema encoding middleware', () =>
    Effect.gen(function* () {
      class EncodingService extends Context.Service<EncodingService, { readonly suffix: string }>()(
        'EncodingService',
      ) {}
      const Payload = Schema.Struct({ value: Schema.String }).pipe(
        Schema.middlewareEncoding((encoding) =>
          Effect.flatMap(encoding, (encoded) => Effect.as(EncodingService, encoded)),
        ),
      )
      const Serviceful = Rpc.make('encoding.serviceful', {
        payload: Payload,
        success: Schema.String,
      })
      const servicefulGroup = RpcGroup.make(Serviceful)
      type ServicefulOptions = CreateRpcQueryUtilsOptions<typeof servicefulGroup, readonly ['app']>
      const client = yield* makeRpcTestClient(servicefulGroup, {
        'encoding.serviceful': () => Effect.succeed('ok'),
      })
      const unsafeOptions = {
        client,
        keyPrefix: ['app'] as const,
      } as unknown as ServicefulOptions

      expect(() => createRpcQueryUtils(servicefulGroup, unsafeOptions)).toThrow(
        expect.objectContaining<Partial<EffectRpcQueryConfigError>>({
          code: 'MissingKeyEncoder',
          rpcTag: 'encoding.serviceful',
        }),
      )

      const safeOptions = {
        client,
        keyEncoders: {
          'encoding.serviceful': (payload: { readonly value: string }) => payload,
        },
        keyPrefix: ['app'] as const,
      } as unknown as ServicefulOptions
      const utils = createRpcQueryUtils(servicefulGroup, safeOptions)

      expect(utils.encoding.serviceful.queryKey({ value: 'safe' })).toEqual([
        'app',
        'rpc',
        'encoding',
        'serviceful',
        'query',
        { value: 'safe' },
      ])
    }),
  )

  it.effect('does not require a key encoder for decoding-only Schema middleware', () =>
    Effect.gen(function* () {
      class DecodingService extends Context.Service<DecodingService, { readonly suffix: string }>()(
        'DecodingService',
      ) {}
      const Payload = Schema.Struct({ value: Schema.String }).pipe(
        Schema.middlewareDecoding((decoding) => Effect.flatMap(DecodingService, () => decoding)),
      )
      const DecodingOnly = Rpc.make('decoding.only', {
        payload: Payload,
        success: Schema.String,
      })
      const decodingGroup = RpcGroup.make(DecodingOnly)
      const client = yield* makeRpcTestClient(decodingGroup, {
        'decoding.only': () => Effect.succeed('ok'),
      })
      const options: CreateRpcQueryUtilsOptions<typeof decodingGroup, readonly ['app']> = {
        client,
        keyPrefix: ['app'] as const,
        runPromiseExit: Effect.runPromiseExit as never,
      }

      const utils = createRpcQueryUtils(decodingGroup, options)

      expect(utils.decoding.only.queryKey({ value: 'safe' })).toEqual([
        'app',
        'rpc',
        'decoding',
        'only',
        'query',
        { value: 'safe' },
      ])
    }),
  )

  it.each(['__proto__', 'constructor'])(
    'rejects unsafe object property %s throughout keys',
    (property) => {
      const rpcGroup = RpcGroup.make(
        Rpc.make('read', {
          payload: Schema.Struct({ value: Schema.Unknown }),
          success: Schema.String,
        }),
      )
      const unsafe = JSON.parse(`{"${property}":null}`) as JsonValue
      for (const value of [unsafe, { nested: [unsafe] }]) {
        const options = { client: unusedClientFor(rpcGroup), keyPrefix: ['app'] as const }
        expect(() =>
          createRpcQueryUtils(rpcGroup, {
            ...options,
            keyPrefix: [value],
          }),
        ).toThrow(expect.objectContaining({ code: 'InvalidKeyPrefix' }))
        for (const keyEncoders of [undefined, { read: () => value }]) {
          const utils = createRpcQueryUtils(rpcGroup, {
            ...options,
            ...(keyEncoders === undefined ? {} : { keyEncoders }),
          })
          expect(() => utils.read.queryKey({ value })).toThrow(
            expect.objectContaining({ code: 'InvalidKeyValue' }),
          )
        }
      }
    },
  )

  it.effect('rejects an own __proto__ property defined by an encoder', () =>
    Effect.gen(function* () {
      const encoded = Object.defineProperty({}, '__proto__', {
        enumerable: true,
        value: 'semantic-value',
      }) as JsonValue
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyEncoders: { 'users.get': () => encoded },
        keyPrefix: ['app'] as const,
      })

      expect(() => utils.users.get.queryKey({ id: 1 })).toThrow(
        expect.objectContaining({ code: 'InvalidKeyValue' }),
      )
    }),
  )
})

const captureKeyError = (run: () => unknown): EffectRpcQueryKeyError => {
  try {
    run()
  } catch (error) {
    if (error instanceof EffectRpcQueryKeyError) {
      return error
    }
    throw error
  }
  throw new Error('Expected key preparation to fail')
}
