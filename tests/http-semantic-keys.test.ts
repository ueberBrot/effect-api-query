import { QueryClient } from '@tanstack/query-core'
import { Context, Effect, Exit, Layer, Redacted, Schema, Scope } from 'effect'
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
import { describe, expect, it } from 'vite-plus/test'

import { createHttpApiQueryUtils } from '#effect-api-query'

const api = HttpApi.make('keys').add(
  HttpApiGroup.make('requests').add(
    HttpApiEndpoint.post('save', '/save', {
      query: { filter: Schema.optional(Schema.String) },
      headers: Schema.Record(Schema.String, Schema.optional(Schema.String)),
      payload: Schema.NullOr(
        Schema.Struct({
          nested: Schema.Struct({
            absent: Schema.optional(Schema.String),
            kept: Schema.Array(Schema.Finite),
          }),
        }),
      ),
    }),
  ),
)
const utils = createHttpApiQueryUtils(api, {
  client: {} as HttpApiClient.ForApi<typeof api>,
  keyPrefix: ['test'],
})

describe('HTTP semantic keys', () => {
  it('reuses equivalent requests and partitions every result-affecting request part', async () => {
    const contract = HttpApi.make('cache').add(
      HttpApiGroup.make('requests').add(
        HttpApiEndpoint.post('read', '/:id', {
          params: { id: Schema.FiniteFromString },
          query: { filter: Schema.optional(Schema.String) },
          headers: Schema.Record(Schema.String, Schema.optional(Schema.String)),
          payload: Schema.Struct({ name: Schema.String }),
          success: Schema.String,
        }),
      ),
    )
    let calls = 0
    const handlers = HttpApiBuilder.group(contract, 'requests', (group) =>
      group.handle('read', ({ params, query, payload, headers }) => {
        calls += 1
        return Effect.succeed(
          JSON.stringify([params.id, query.filter, payload.name, headers['x-locale']]),
        )
      }),
    )
    const scope = Scope.makeUnsafe()
    const client = await Effect.runPromise(
      HttpApiTest.groups(contract, ['requests']).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope),
      ),
    )
    const http = createHttpApiQueryUtils(contract, { client, keyPrefix: ['test'] })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    const input = {
      params: { id: 1 },
      query: {},
      headers: { 'X-Locale': 'en' },
      payload: { name: 'Ada' },
    }
    try {
      const read = (request: typeof input) =>
        queryClient.query(http.requests.read.queryOptions({ input: request }))
      expect(await read(input)).toBe('[1,null,"Ada","en"]')
      expect(
        await read({
          ...input,
          query: { filter: undefined },
          headers: { 'x-locale': 'en' },
        } as never),
      ).toBe('[1,null,"Ada","en"]')
      expect(calls).toBe(1)
      expect(await read({ ...input, params: { id: 2 } })).toBe('[2,null,"Ada","en"]')
      expect(await read({ ...input, query: { filter: 'active' } })).toBe('[1,"active","Ada","en"]')
      expect(await read({ ...input, payload: { name: 'Grace' } })).toBe('[1,null,"Grace","en"]')
      expect(await read({ ...input, headers: { 'X-Locale': 'de' } })).toBe('[1,null,"Ada","de"]')
      expect(calls).toBe(5)
    } finally {
      queryClient.clear()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('encodes text, form, URL payloads, and binary requests through the ready client', async () => {
    const fields = Schema.Struct({
      page: Schema.FiniteFromString,
      filter: Schema.optional(Schema.String),
    })
    const contract = HttpApi.make('formats').add(
      HttpApiGroup.make('formats', { topLevel: true }).add(
        HttpApiEndpoint.post('text', '/text', {
          payload: Schema.FiniteFromString.pipe(HttpApiSchema.asText()),
          success: Schema.Finite,
        }),
        HttpApiEndpoint.post('form', '/form', {
          payload: fields.pipe(HttpApiSchema.asFormUrlEncoded()),
          success: Schema.Finite,
        }),
        HttpApiEndpoint.get('search', '/search', {
          payload: fields.fields,
          query: { sort: Schema.String },
          success: Schema.String,
        }),
        HttpApiEndpoint.post('binary', '/binary', {
          payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
          success: Schema.Finite,
        }),
      ),
    )
    const handlers = HttpApiBuilder.group(contract, 'formats', (group) =>
      group
        .handle('text', ({ payload }) => Effect.succeed(payload))
        .handle('form', ({ payload }) => Effect.succeed(payload.page))
        .handle('search', ({ payload, query }) => Effect.succeed(`${payload.page}:${query.sort}`))
        .handle('binary', ({ payload }) => Effect.succeed(payload[0]!)),
    )
    const scope = Scope.makeUnsafe()
    const client = await Effect.runPromise(
      HttpApiTest.groups(contract, ['formats']).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope),
      ),
    )
    const http = createHttpApiQueryUtils(contract, {
      client,
      keyPrefix: ['formats'],
      keyEncoders: { formats: { binary: ({ payload }) => ({ bytes: Array.from(payload) }) } },
    })
    const queryClient = new QueryClient()
    try {
      expect(http.text.queryKey({ payload: 42 }).at(-1)).toEqual({ payload: '42' })
      expect(await queryClient.query(http.text.queryOptions({ input: { payload: 42 } }))).toBe(42)
      expect(http.form.queryKey({ payload: { page: 2, filter: undefined } }).at(-1)).toEqual({
        payload: { page: '2' },
      })
      expect(
        await queryClient.query(http.form.queryOptions({ input: { payload: { page: 2 } } })),
      ).toBe(2)
      const search = { payload: { page: 3 }, query: { sort: 'name' } }
      expect(http.search.queryKey(search).at(-1)).toEqual({
        payload: { page: '3' },
        query: { sort: 'name' },
      })
      expect(await queryClient.query(http.search.queryOptions({ input: search }))).toBe('3:name')
      expect(
        await queryClient.query(
          http.binary.queryOptions({ input: { payload: new Uint8Array([7]) } }),
        ),
      ).toBe(7)
      const defaults = createHttpApiQueryUtils(contract, { client, keyPrefix: ['default'] })
      expect(() => defaults.binary.queryKey({ payload: new Uint8Array([7]) })).toThrow(
        expect.objectContaining({ code: 'InvalidKeyValue' }),
      )
    } finally {
      queryClient.clear()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
  it('omits undefined object members and normalizes encoded header names', () => {
    const key = utils.requests.save.queryKey({
      query: { filter: undefined },
      headers: { 'X-Locale': 'en', 'x-locale': 'en', ignored: undefined },
      payload: { nested: { kept: [2, 1] } },
    })
    expect(key.at(-1)).toEqual({
      query: {},
      headers: { 'x-locale': 'en' },
      payload: { nested: { kept: [2, 1] } },
    })
    expect(key).toEqual(
      utils.requests.save.queryKey({
        query: {},
        headers: { 'x-locale': 'en' },
        payload: { nested: { kept: [2, 1] } },
      }),
    )
    expect(Object.isFrozen(key)).toBe(true)
    expect(Object.isFrozen(key.at(-1))).toBe(true)
  })

  it('rejects conflicting case-insensitive headers before invocation', () => {
    expect(() =>
      utils.requests.save.queryOptions({
        input: {
          query: {},
          headers: { 'X-Locale': 'en', 'x-locale': 'de' },
          payload: null,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'InvalidKeyValue' }))
  })

  it('preserves array order and rejects missing array entries in default request keys', () => {
    const contract = HttpApi.make('arrays').add(
      HttpApiGroup.make('search').add(
        HttpApiEndpoint.get('find', '/find', { query: { values: Schema.Array(Schema.String) } }),
      ),
    )
    const http = createHttpApiQueryUtils(contract, {
      client: {} as HttpApiClient.ForApi<typeof contract>,
      keyPrefix: ['test'],
    })
    expect(http.search.find.queryKey({ query: { values: ['b', 'a'] } }).at(-1)).toEqual({
      query: { values: ['b', 'a'] },
    })
    expect(http.search.find.queryKey({ query: { values: ['b', 'a'] } })).not.toEqual(
      http.search.find.queryKey({ query: { values: ['a', 'b'] } }),
    )
    for (const values of [Array(1), [undefined]]) {
      expect(() =>
        http.search.find.queryOptions({ input: { query: { values } } } as never),
      ).toThrow(expect.objectContaining({ _tag: 'EffectHttpApiQueryKeyError' }))
    }
  })

  it('keeps custom encoder output strict, copied, and deeply frozen', () => {
    const input = { query: {}, headers: {}, payload: null }
    const value = { nested: { values: [2, 1] } }
    const custom = (encode: () => unknown) =>
      createHttpApiQueryUtils(api, {
        client: {} as HttpApiClient.ForApi<typeof api>,
        keyPrefix: ['test'],
        keyEncoders: { requests: { save: encode as never } },
      })
    const key = custom(() => value).requests.save.queryKey(input)
    value.nested.values.push(3)
    expect(key.at(-1)).toEqual({ nested: { values: [2, 1] } })
    expect(Object.isFrozen((key.at(-1) as typeof value).nested.values)).toBe(true)
    const cycle: Record<string, unknown> = {}
    cycle['self'] = cycle
    for (const invalid of [
      undefined,
      { absent: undefined },
      [undefined],
      Array(1),
      Number.NaN,
      Infinity,
      1n,
      new Date(),
      new Uint8Array([1]),
      cycle,
      () => null,
    ]) {
      expect(() => custom(() => invalid).requests.save.queryOptions({ input })).toThrow(
        expect.objectContaining({ code: 'InvalidKeyValue' }),
      )
    }
  })

  it('validates the declaration-based encoder map atomically, including empty unknown groups', () => {
    const contract = HttpApi.make('maps').add(
      HttpApiGroup.make('forms.v1', { topLevel: true }).add(
        HttpApiEndpoint.post('save.one', '/save', { payload: [Schema.String, Schema.Finite] }),
        HttpApiEndpoint.get('ping', '/ping'),
        HttpApiEndpoint.post('upload', '/upload', {
          payload: Schema.Struct({ file: Schema.String }).pipe(HttpApiSchema.asMultipart()),
        }),
      ),
    )
    let encoded = false
    const encode = () => {
      encoded = true
      return null
    }
    for (const keyEncoders of [
      { unknown: {} },
      { 'forms.v1.save.one': encode },
      { 'forms.v1': { unknown: encode } },
      { 'forms.v1': { ping: encode } },
      { 'forms.v1': { upload: encode } },
    ]) {
      expect(() =>
        createHttpApiQueryUtils(contract, {
          client: {} as never,
          keyPrefix: ['test'],
          keyEncoders,
        } as never),
      ).toThrow(expect.objectContaining({ code: 'UnknownKeyEncoder' }))
    }
    expect(encoded).toBe(false)
    const custom = createHttpApiQueryUtils(contract, {
      client: {} as HttpApiClient.ForApi<typeof contract>,
      keyPrefix: ['test'],
      keyEncoders: {
        'forms.v1': { 'save.one': ({ payload }) => ({ kind: typeof payload, value: payload }) },
      },
    })
    expect(custom['save.one'].queryKey({ payload: 1 }).at(-1)).toEqual({ kind: 'number', value: 1 })
  })

  it('distinguishes equal encoded scalars sent with different payload encodings', async () => {
    const contract = HttpApi.make('alternatives').add(
      HttpApiGroup.make('forms').add(
        HttpApiEndpoint.post('submit', '/submit', {
          payload: [Schema.FiniteFromString.pipe(HttpApiSchema.asText()), Schema.String],
          success: Schema.String,
        }),
      ),
    )
    const handlers = HttpApiBuilder.group(contract, 'forms', (group) =>
      group.handle('submit', ({ payload }) => Effect.succeed(`${typeof payload}:${payload}`)),
    )
    const scope = Scope.makeUnsafe()
    const client = await Effect.runPromise(
      HttpApiTest.groups(contract, ['forms']).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope),
      ),
    )
    const http = createHttpApiQueryUtils(contract, {
      client,
      keyPrefix: ['test'],
      keyEncoders: {
        forms: {
          submit: ({ payload }) => ({
            format: typeof payload === 'number' ? 'text' : 'json',
            value: String(payload),
          }),
        },
      },
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    try {
      expect(
        await queryClient.query(http.forms.submit.queryOptions({ input: { payload: 1 } })),
      ).toBe('number:1')
      expect(
        await queryClient.query(http.forms.submit.queryOptions({ input: { payload: '1' } })),
      ).toBe('string:1')
      expect(http.forms.submit.queryKey({ payload: 1 })).not.toEqual(
        http.forms.submit.queryKey({ payload: '1' }),
      )
    } finally {
      queryClient.clear()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('requires an encoder for Redacted values and opaque encoding middleware in every request part', () => {
    class Encoding extends Context.Service<Encoding, {}>()('HttpKeys/Encoding') {}
    const plain = Schema.Struct({ value: Schema.String })
    const schemas = [
      Schema.Struct({ value: Schema.Redacted(Schema.String) }),
      plain.pipe(
        Schema.middlewareEncoding<typeof plain, Encoding>((encoding) =>
          Effect.flatMap(Encoding, () => encoding),
        ),
      ),
      plain.pipe(Schema.middlewareEncoding((encoding) => encoding)),
    ]
    for (const part of ['params', 'query', 'headers', 'payload'] as const) {
      for (const schema of schemas) {
        const contract = HttpApi.make('unsafe').add(
          HttpApiGroup.make('requests').add(
            HttpApiEndpoint.post('save', '/:value', { [part]: schema }),
          ),
        )
        expect(() =>
          createHttpApiQueryUtils(contract, {
            client: {} as never,
            keyPrefix: ['test'],
          } as never),
        ).toThrow(expect.objectContaining({ code: 'MissingKeyEncoder' }))
        let received: unknown
        const safe = createHttpApiQueryUtils(contract, {
          client: {} as never,
          keyPrefix: ['test'],
          keyEncoders: {
            requests: {
              save: (request: unknown) => {
                received = request
                return { identity: 'public-id' }
              },
            },
          },
        } as never)
        const input = { [part]: { value: Redacted.make('secret') } }
        expect(
          (safe.requests.save.queryKey as (input: unknown) => readonly unknown[])(input).at(-1),
        ).toEqual({ identity: 'public-id' })
        expect(received).toBe(input)
      }
    }
  })
})
