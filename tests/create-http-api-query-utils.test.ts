import { QueryClient } from '@tanstack/query-core'
import { Cause, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { HttpServer } from 'effect/unstable/http'
import {
  HttpApi,
  HttpApiBuilder,
  type HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/unstable/httpapi'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { describe, expect, it } from 'vite-plus/test'

import {
  createHttpApiQueryUtils,
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryError,
  EffectHttpApiQueryKeyError,
  isEffectHttpApiQueryError,
  createRpcQueryUtils,
} from '#effect-api-query'

const Api = HttpApi.make('test').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.FiniteFromString },
      success: Schema.Struct({ id: Schema.Finite, name: Schema.String }),
    }),
    HttpApiEndpoint.post('create', '/users', {
      payload: Schema.Struct({ name: Schema.String }),
      success: Schema.Struct({ id: Schema.Finite, name: Schema.String }),
    }),
    HttpApiEndpoint.delete('remove', '/users/:id', { params: { id: Schema.FiniteFromString } }),
  ),
)
const Handlers = HttpApiBuilder.group(Api, 'users', (handlers) =>
  handlers
    .handle('get', ({ params }) => Effect.succeed({ id: params.id, name: 'Ada' }))
    .handle('create', ({ payload }) => Effect.succeed({ id: 2, name: payload.name }))
    .handle('remove', () => Effect.void),
)

const makeClient = HttpApiTest.groups(Api, ['users']).pipe(
  Effect.provide(Layer.mergeAll(Handlers, HttpServer.layerServices)),
)

describe('createHttpApiQueryUtils', () => {
  it('rejects sparse key prefixes through both adapters, including nested arrays', () => {
    const sparse = ['app', 'tenant'] as const
    Reflect.deleteProperty(sparse, 1)

    for (const keyPrefix of [sparse, ['app', sparse] as const]) {
      expect(() =>
        createHttpApiQueryUtils(HttpApi.make('empty'), { client: {}, keyPrefix }),
      ).toThrow(
        expect.objectContaining({
          _tag: 'EffectHttpApiQueryConfigError',
          code: 'InvalidKeyPrefix',
        }),
      )
      expect(() =>
        createRpcQueryUtils(RpcGroup.make(), { client: () => Effect.void, keyPrefix }),
      ).toThrow(
        expect.objectContaining({
          _tag: 'EffectRpcQueryConfigError',
          code: 'InvalidKeyPrefix',
        }),
      )
    }
  })

  it('executes decoded reads and writes through the real HTTP pipeline and QueryClient', async () => {
    const scope = Scope.makeUnsafe()
    const client = await Effect.runPromise(
      makeClient.pipe(Effect.provideService(Scope.Scope, scope)),
    )
    const utils = createHttpApiQueryUtils(Api, { client, keyPrefix: ['shared'] })
    const queryClient = new QueryClient()
    try {
      expect(
        await queryClient.query(
          utils.users.get.queryOptions({
            input: { params: { id: 1 }, responseMode: 'response-only' } as never,
          }),
        ),
      ).toEqual({ id: 1, name: 'Ada' })
      const mutation = queryClient
        .getMutationCache()
        .build(queryClient, utils.users.create.mutationOptions())
      expect(
        await mutation.execute({
          payload: { name: 'Grace' },
          responseMode: 'decoded-and-response',
        } as never),
      ).toEqual({
        id: 2,
        name: 'Grace',
      })
      expect(
        await queryClient.query(utils.users.remove.queryOptions({ input: { params: { id: 1 } } })),
      ).toBeNull()
      expect(
        await queryClient
          .getMutationCache()
          .build(queryClient, utils.users.remove.mutationOptions())
          .execute({ params: { id: 1 } }),
      ).toBeUndefined()
      expect(utils.users.get.queryKey({ params: { id: 1 } })).toEqual([
        'shared',
        'http',
        'test',
        'users',
        'get',
        'query',
        { params: { id: '1' } },
      ])
    } finally {
      queryClient.clear()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
  it('omits whole streaming and multipart endpoints and their empty groups', () => {
    const streaming = HttpApiEndpoint.get('mixed', '/mixed', {
      success: [
        Schema.String,
        HttpApiSchema.StreamUint8Array({ contentType: 'application/octet-stream' }),
      ],
    })
    const wrapped = HttpApiEndpoint.get('wrapped', '/wrapped', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array(), {}),
    })
    const multipart = HttpApiEndpoint.post('upload', '/upload', {
      payload: [
        Schema.Struct({ title: Schema.String }),
        Schema.Struct({ file: Schema.String }).pipe(HttpApiSchema.asMultipart()),
      ],
    })
    const mixed = HttpApi.make('mixed').add(
      HttpApiGroup.make('empty').add(streaming, wrapped, multipart),
      HttpApiGroup.make('kept').add(
        HttpApiEndpoint.get('read', '/read', { success: Schema.String }),
        streaming,
      ),
    )
    const utils = createHttpApiQueryUtils(mixed, {
      client: {} as HttpApiClient.ForApi<typeof mixed>,
      keyPrefix: ['test'],
    })
    expect(Object.keys(utils)).toEqual(['key', 'kept'])
    expect(Object.keys(utils.kept)).toEqual(['key', 'read'])
  })

  it('rejects contradictory multipart brands and encoding atomically', () => {
    const contradictory = [
      Schema.Struct({ file: Schema.String }).pipe(
        HttpApiSchema.asMultipart(),
        HttpApiSchema.asJson(),
      ),
      Schema.Struct({ file: Schema.String }).annotate({
        '~httpApiEncoding': {
          _tag: 'Multipart',
          mode: 'buffered',
          contentType: 'multipart/form-data',
        },
      }),
      Schema.Struct({ file: Schema.String })
        .pipe(HttpApiSchema.asMultipartStream())
        .annotate({
          '~httpApiEncoding': {
            _tag: 'Multipart',
            mode: 'buffered',
            contentType: 'multipart/form-data',
          },
        }),
    ]
    for (const payload of contradictory) {
      const api = HttpApi.make('invalid').add(
        HttpApiGroup.make('files').add(
          HttpApiEndpoint.get('read', '/read', { success: Schema.String }),
          HttpApiEndpoint.post('upload', '/upload', { payload }),
        ),
      )
      expect(() =>
        createHttpApiQueryUtils(api, {
          client: {} as HttpApiClient.ForApi<typeof api>,
          keyPrefix: ['test'],
        }),
      ).toThrow(
        expect.objectContaining({
          _tag: 'EffectHttpApiQueryConfigError',
          code: 'UnsupportedEndpointMetadata',
          apiId: 'invalid',
          groupId: 'files',
          endpoint: 'upload',
          method: 'POST',
        }),
      )
    }
  })

  it('projects literal identifiers and top-level inputless endpoints without splitting dots', async () => {
    const api = HttpApi.make('literal.api').add(
      HttpApiGroup.make('users.v1').add(
        HttpApiEndpoint.get('read.one', '/one', { success: Schema.String }),
      ),
      HttpApiGroup.make('health.group', { topLevel: true }).add(
        HttpApiEndpoint.get('health.check', '/health', { success: Schema.String }),
      ),
    )
    const calls: unknown[] = []
    const client = {
      'users.v1': {
        'read.one': (request: unknown) => {
          calls.push(request)
          return Effect.succeed('one')
        },
      },
      'health.check': (request: unknown) => {
        calls.push(request)
        return Effect.succeed('healthy')
      },
    }
    const utils = createHttpApiQueryUtils(api, {
      client: client as unknown as HttpApiClient.ForApi<typeof api>,
      keyPrefix: ['test'],
    })
    const queryClient = new QueryClient()
    try {
      expect(await queryClient.query(utils['users.v1']['read.one'].queryOptions())).toBe('one')
      expect(await queryClient.query(utils['health.check'].queryOptions())).toBe('healthy')
      expect(calls).toEqual([{ responseMode: 'decoded-only' }, { responseMode: 'decoded-only' }])
      expect(utils['health.check'].queryKey()).toEqual([
        'test',
        'http',
        'literal.api',
        'health.check',
        'query',
      ])
      expect(Object.keys(utils['health.check'])).toEqual([
        'infiniteKey',
        'infiniteOptions',
        'key',
        'mutationKey',
        'mutationOptions',
        'queryKey',
        'queryOptions',
      ])
      expect(Object.isFrozen(utils)).toBe(true)
      expect(Object.isFrozen(utils['users.v1'])).toBe(true)
    } finally {
      queryClient.clear()
    }
  })

  it('rejects reserved paths and top-level collisions before constructing utilities', () => {
    const invalidApis = [
      HttpApi.make('invalid').add(
        HttpApiGroup.make('key').add(HttpApiEndpoint.get('read', '/read')),
      ),
      HttpApi.make('invalid').add(
        HttpApiGroup.make('safe').add(HttpApiEndpoint.get('constructor', '/read')),
      ),
      HttpApi.make('invalid').add(
        HttpApiGroup.make('', { topLevel: true }).add(HttpApiEndpoint.get('', '/read')),
      ),
    ]
    for (const api of invalidApis)
      expect(() =>
        createHttpApiQueryUtils(api, {
          client: {} as HttpApiClient.ForApi<typeof api>,
          keyPrefix: ['test'],
        }),
      ).toThrow(expect.objectContaining({ code: 'InvalidEndpointPath' }))
    const topLevel = HttpApiGroup.make('top', { topLevel: true }).add(
      HttpApiEndpoint.get('users', '/top'),
    )
    const nested = HttpApiGroup.make('users').add(HttpApiEndpoint.get('read', '/users'))
    for (const groups of [
      [topLevel, nested],
      [nested, topLevel],
    ] as const) {
      const api = HttpApi.make('collision').add(...groups)
      expect(() =>
        createHttpApiQueryUtils(api, {
          client: {} as HttpApiClient.ForApi<typeof api>,
          keyPrefix: ['test'],
        }),
      ).toThrow(expect.objectContaining({ code: 'EndpointPathCollision' }))
    }
    const duplicate = HttpApi.make('duplicate').add(
      topLevel,
      HttpApiGroup.make('another', { topLevel: true }).add(
        HttpApiEndpoint.get('users', '/another'),
      ),
    )
    expect(() =>
      createHttpApiQueryUtils(duplicate, {
        client: {} as HttpApiClient.ForApi<typeof duplicate>,
        keyPrefix: ['test'],
      }),
    ).toThrow(EffectHttpApiQueryConfigError)
  })

  it('preserves the complete failed Cause and passes runner rejections through', async () => {
    const api = HttpApi.make('failure').add(
      HttpApiGroup.make('actions').add(
        HttpApiEndpoint.get('fail', '/fail', { success: Schema.String, error: Schema.String }),
      ),
    )
    const cause = Cause.combine(Cause.fail('denied'), Cause.die(new Error('defect')))
    const client = { actions: { fail: () => Effect.failCause(cause) } }
    const utils = createHttpApiQueryUtils(api, {
      client: client as unknown as HttpApiClient.ForApi<typeof api>,
      keyPrefix: ['test'],
    })
    const queryClient = new QueryClient()
    try {
      const error = await queryClient
        .query(utils.actions.fail.queryOptions())
        .catch((error: unknown) => error)
      expect(error).toBeInstanceOf(EffectHttpApiQueryError)
      expect(isEffectHttpApiQueryError(error)).toBe(true)
      expect(error).toMatchObject({
        apiId: 'failure',
        groupId: 'actions',
        endpoint: 'fail',
        method: 'GET',
        operation: 'query',
        cause,
      })
      if (isEffectHttpApiQueryError(error)) expect(error.cause).toBe(cause)
      const rejection = new Error('runner')
      const rejected = createHttpApiQueryUtils(api, {
        client: client as unknown as HttpApiClient.ForApi<typeof api>,
        keyPrefix: ['test'],
        runPromiseExit: (): Promise<never> => Promise.reject(rejection),
      })
      await expect(queryClient.query(rejected.actions.fail.queryOptions())).rejects.toBe(rejection)
    } finally {
      queryClient.clear()
    }
  })

  it('invalidates HTTP roots, groups, and endpoints independently of overlapping RPC keys', async () => {
    const api = HttpApi.make('cache').add(
      HttpApiGroup.make('users').add(
        HttpApiEndpoint.get('get', '/users/:id', {
          params: { id: Schema.FiniteFromString },
          success: Schema.String,
        }),
        HttpApiEndpoint.get('list', '/users', { success: Schema.String }),
      ),
    )
    const http = createHttpApiQueryUtils(api, {
      client: {} as HttpApiClient.ForApi<typeof api>,
      keyPrefix: ['shared'],
    })
    const group = RpcGroup.make(
      Rpc.make('users.get', {
        payload: Schema.Struct({ id: Schema.Finite }),
        success: Schema.String,
      }),
    )
    const rpc = createRpcQueryUtils(group, {
      client: (() => Effect.succeed('rpc')) as never,
      keyPrefix: ['shared'],
    })
    const queryClient = new QueryClient()
    const first = http.users.get.queryKey({ params: { id: 1 } })
    const second = http.users.get.queryKey({ params: { id: 2 } })
    const other = http.users.list.queryKey()
    const rpcKey = rpc.users.get.queryKey({ id: 1 })
    try {
      for (const key of [first, second, other, rpcKey]) queryClient.setQueryData(key, 'cached')
      expect(http.users.get.mutationKey()).not.toEqual(
        http.users.get.queryKey({ params: { id: 1 } }),
      )
      await queryClient.invalidateQueries({ queryKey: http.users.get.key() })
      expect(queryClient.getQueryState(first)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(second)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false)
      expect(queryClient.getQueryState(rpcKey)?.isInvalidated).toBe(false)
      await queryClient.invalidateQueries({ queryKey: http.users.key() })
      expect(queryClient.getQueryState(other)?.isInvalidated).toBe(true)
      queryClient.setQueryData(other, 'fresh')
      await queryClient.invalidateQueries({ queryKey: http.key() })
      expect(queryClient.getQueryState(other)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(rpcKey)?.isInvalidated).toBe(false)
    } finally {
      queryClient.clear()
    }
  })

  it('requires custom keys for multiple payload alternatives and reports encoder failures', () => {
    const api = HttpApi.make('keys').add(
      HttpApiGroup.make('forms', { topLevel: true }).add(
        HttpApiEndpoint.post('submit', '/submit', {
          payload: [Schema.String, Schema.Finite],
          success: Schema.String,
        }),
      ),
    )
    expect(() =>
      createHttpApiQueryUtils(api, {
        client: {} as HttpApiClient.ForApi<typeof api>,
        keyPrefix: ['test'],
      } as never),
    ).toThrow(expect.objectContaining({ code: 'MissingKeyEncoder' }))
    const utils = createHttpApiQueryUtils(api, {
      client: {} as HttpApiClient.ForApi<typeof api>,
      keyPrefix: ['test'],
      keyEncoders: { forms: { submit: ({ payload }) => ({ payload }) } },
    })
    expect(utils.submit.queryKey({ payload: 'yes' })).toEqual([
      'test',
      'http',
      'keys',
      'submit',
      'query',
      { payload: 'yes' },
    ])
    const cause = new Error('encoder')
    const invalid = createHttpApiQueryUtils(api, {
      client: {} as HttpApiClient.ForApi<typeof api>,
      keyPrefix: ['test'],
      keyEncoders: {
        forms: {
          submit: () => {
            throw cause
          },
        },
      },
    })
    expect(() => invalid.submit.queryKey({ payload: 1 })).toThrow(
      expect.objectContaining({
        _tag: 'EffectHttpApiQueryKeyError',
        code: 'KeyEncoderFailed',
        cause,
      }),
    )
    expect(() => invalid.submit.queryKey({ payload: 1 })).toThrow(EffectHttpApiQueryKeyError)
  })
  it('labels all declared request fields in keys and reports synchronous key failures', () => {
    const api = HttpApi.make('labels').add(
      HttpApiGroup.make('users').add(
        HttpApiEndpoint.post('save', '/users/:id', {
          params: { id: Schema.FiniteFromString },
          query: { page: Schema.FiniteFromString },
          headers: { 'x-version': Schema.FiniteFromString },
          payload: Schema.Struct({ name: Schema.String }),
        }),
      ),
    )
    const utils = createHttpApiQueryUtils(api, {
      client: {} as HttpApiClient.ForApi<typeof api>,
      keyPrefix: ['test'],
    })
    const input = {
      params: { id: 1 },
      query: { page: 2 },
      headers: { 'x-version': 3 },
      payload: { name: 'Ada' },
    }
    const key = utils.users.save.queryKey(input)
    expect(key.at(-1)).toEqual({
      params: { id: '1' },
      query: { page: '2' },
      headers: { 'x-version': '3' },
      payload: { name: 'Ada' },
    })
    input.payload.name = 'Grace'
    expect(key.at(-1)).toMatchObject({ payload: { name: 'Ada' } })
    expect(() => utils.users.save.queryKey({ ...input, params: { id: 'raw' } } as never)).toThrow(
      expect.objectContaining({ code: 'RequestEncodingFailed', endpoint: 'save' }),
    )
    const unsafe = createHttpApiQueryUtils(api, {
      client: {} as HttpApiClient.ForApi<typeof api>,
      keyPrefix: ['test'],
      keyEncoders: { users: { save: () => Number.NaN } },
    })
    expect(() => unsafe.users.save.queryKey(input)).toThrow(
      expect.objectContaining({ code: 'InvalidKeyValue' }),
    )
    expect(() =>
      createHttpApiQueryUtils(api, {
        client: {} as HttpApiClient.ForApi<typeof api>,
        keyPrefix: [],
      } as never),
    ).toThrow(expect.objectContaining({ code: 'InvalidKeyPrefix' }))
    expect(() =>
      createHttpApiQueryUtils(api, {
        client: {} as HttpApiClient.ForApi<typeof api>,
        keyPrefix: ['test'],
        keyEncoders: { users: { missing: () => null } },
      } as never),
    ).toThrow(expect.objectContaining({ code: 'UnknownKeyEncoder' }))
  })
})
