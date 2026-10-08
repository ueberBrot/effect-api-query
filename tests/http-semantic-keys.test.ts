import { QueryClient } from '@tanstack/query-core'
import { Context, Effect, Exit, Layer, Predicate, Redacted, Schema, Scope } from 'effect'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/http-api'
import { describe, expect, it } from 'vite-plus/test'

import { createHttpApiQueryUtils } from '#effect-api-query'

import { unusedHttpClientFor } from './fixtures/http-client'

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
  client: unusedHttpClientFor(api),
  keyPrefix: ['test'],
})

// SAFETY: The encoder deliberately returns malformed JavaScript values to exercise strict JSON rejection.
/* oxlint-disable anti-slop/no-unknown-returns, typescript/no-unsafe-type-assertion */
const encodeTestKey = (encode: () => unknown) =>
  createHttpApiQueryUtils(api, {
    client: unusedHttpClientFor(api),
    keyPrefix: ['test'],
    keyEncoders: { requests: { save: encode as never } },
  })
/* oxlint-enable anti-slop/no-unknown-returns, typescript/no-unsafe-type-assertion */

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
      const read = async (request: typeof input) =>
        await queryClient.query(http.requests.read.queryOptions({ input: request }))
      await expect(read(input)).resolves.toBe('[1,null,"Ada","en"]')
      // SAFETY: A required encoder is deliberately omitted to verify the synchronous configuration-error boundary.
      /* oxlint-disable typescript/no-unsafe-type-assertion */
      await expect(
        read({
          ...input,
          query: { filter: undefined },
          headers: { 'x-locale': 'en' },
        } as never),
      ).resolves.toBe('[1,null,"Ada","en"]')
      /* oxlint-enable typescript/no-unsafe-type-assertion */
      expect(calls).toBe(1)
      await expect(read({ ...input, params: { id: 2 } })).resolves.toBe('[2,null,"Ada","en"]')
      await expect(read({ ...input, query: { filter: 'active' } })).resolves.toBe(
        '[1,"active","Ada","en"]',
      )
      await expect(read({ ...input, payload: { name: 'Grace' } })).resolves.toBe(
        '[1,null,"Grace","en"]',
      )
      await expect(read({ ...input, headers: { 'X-Locale': 'de' } })).resolves.toBe(
        '[1,null,"Ada","de"]',
      )
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
        .handle('binary', ({ payload }) => {
          const [firstByte] = payload
          if (firstByte === undefined) {
            return Effect.die(new Error('Expected a nonempty binary payload'))
          }
          return Effect.succeed(firstByte)
        }),
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
      keyEncoders: { formats: { binary: ({ payload }) => ({ bytes: [...payload] }) } },
    })
    const queryClient = new QueryClient()
    try {
      expect(http.text.queryKey({ payload: 42 }).at(-1)).toStrictEqual({ payload: '42' })
      await expect(
        queryClient.query(http.text.queryOptions({ input: { payload: 42 } })),
      ).resolves.toBe(42)
      expect(http.form.queryKey({ payload: { page: 2, filter: undefined } }).at(-1)).toStrictEqual({
        payload: { page: '2' },
      })
      await expect(
        queryClient.query(http.form.queryOptions({ input: { payload: { page: 2 } } })),
      ).resolves.toBe(2)
      const search = { payload: { page: 3 }, query: { sort: 'name' } }
      expect(http.search.queryKey(search).at(-1)).toStrictEqual({
        payload: { page: '3' },
        query: { sort: 'name' },
      })
      await expect(queryClient.query(http.search.queryOptions({ input: search }))).resolves.toBe(
        '3:name',
      )
      await expect(
        queryClient.query(http.binary.queryOptions({ input: { payload: new Uint8Array([7]) } })),
      ).resolves.toBe(7)
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
    expect(key.at(-1)).toStrictEqual({
      query: {},
      headers: { 'x-locale': 'en' },
      payload: { nested: { kept: [2, 1] } },
    })
    expect(key).toStrictEqual(
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
      client: unusedHttpClientFor(contract),
      keyPrefix: ['test'],
    })
    expect(http.search.find.queryKey({ query: { values: ['b', 'a'] } }).at(-1)).toStrictEqual({
      query: { values: ['b', 'a'] },
    })
    expect(http.search.find.queryKey({ query: { values: ['b', 'a'] } })).not.toStrictEqual(
      http.search.find.queryKey({ query: { values: ['a', 'b'] } }),
    )
    // SAFETY: The sparse array deliberately preserves missing entries so strict JSON validation can reject it.
    /* oxlint-disable unicorn/no-new-array */
    for (const values of [new Array<unknown>(1), [undefined]]) {
      // SAFETY: A required encoder is deliberately omitted to verify the synchronous configuration-error boundary.
      /* oxlint-disable typescript/no-unsafe-type-assertion */
      expect(() =>
        http.search.find.queryOptions({ input: { query: { values } } } as never),
      ).toThrow(expect.objectContaining({ _tag: 'EffectHttpApiQueryKeyError' }))
      /* oxlint-enable typescript/no-unsafe-type-assertion */
    }
    /* oxlint-enable unicorn/no-new-array */
  })

  it('keeps custom encoder output strict, copied, and deeply frozen', () => {
    const input = { query: {}, headers: {}, payload: null }
    const value = { nested: { values: [2, 1] } }
    const key = encodeTestKey(() => value).requests.save.queryKey(input)
    value.nested.values.push(3)
    expect(key.at(-1)).toStrictEqual({ nested: { values: [2, 1] } })
    const encoded = key.at(-1)
    if (!Predicate.isObject(encoded) || !Predicate.isObject(encoded['nested'])) {
      throw new TypeError('Expected a nested canonical key value')
    }
    expect(Object.isFrozen(encoded['nested']['values'])).toBe(true)
    interface Cycle {
      self?: Cycle
    }
    const cycle: Cycle = {}
    cycle.self = cycle
    // SAFETY: The sparse array deliberately preserves missing entries so strict JSON validation can reject it.
    /* oxlint-disable unicorn/no-new-array */
    for (const invalid of [
      undefined,
      { absent: undefined },
      [undefined],
      new Array<unknown>(1),
      Number.NaN,
      Infinity,
      1n,
      new Date(),
      new Uint8Array([1]),
      cycle,
      () => null,
    ]) {
      expect(() => encodeTestKey(() => invalid).requests.save.queryOptions({ input })).toThrow(
        expect.objectContaining({ code: 'InvalidKeyValue' }),
      )
    }
    /* oxlint-enable unicorn/no-new-array */
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
      // SAFETY: Undeclared encoders deliberately exercise atomic validation of the encoder map.
      /* oxlint-disable typescript/no-unsafe-type-assertion */
      expect(() =>
        createHttpApiQueryUtils(contract, {
          client: unusedHttpClientFor(contract),
          keyPrefix: ['test'],
          keyEncoders,
        } as never),
      ).toThrow(expect.objectContaining({ code: 'UnknownKeyEncoder' }))
      /* oxlint-enable typescript/no-unsafe-type-assertion */
    }
    expect(encoded).toBe(false)
    const custom = createHttpApiQueryUtils(contract, {
      client: unusedHttpClientFor(contract),
      keyPrefix: ['test'],
      keyEncoders: {
        'forms.v1': {
          'save.one': ({ payload }) => ({
            kind: Predicate.isNumber(payload) ? 'number' : 'string',
            value: payload,
          }),
        },
      },
    })
    expect(custom['save.one'].queryKey({ payload: 1 }).at(-1)).toStrictEqual({
      kind: 'number',
      value: 1,
    })
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
      group.handle('submit', ({ payload }) =>
        Effect.succeed(`${Predicate.isNumber(payload) ? 'number' : 'string'}:${payload}`),
      ),
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
            format: Predicate.isNumber(payload) ? 'text' : 'json',
            value: String(payload),
          }),
        },
      },
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    try {
      await expect(
        queryClient.query(http.forms.submit.queryOptions({ input: { payload: 1 } })),
      ).resolves.toBe('number:1')
      await expect(
        queryClient.query(http.forms.submit.queryOptions({ input: { payload: '1' } })),
      ).resolves.toBe('string:1')
      expect(http.forms.submit.queryKey({ payload: 1 })).not.toStrictEqual(
        http.forms.submit.queryKey({ payload: '1' }),
      )
    } finally {
      queryClient.clear()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('requires an encoder for Redacted values and opaque encoding middleware in every request part', () => {
    class Encoding extends Context.Service<Encoding, Record<string, never>>()(
      'HttpKeys/Encoding',
    ) {}
    const plain = Schema.Struct({ value: Schema.String })
    const schemas = [
      Schema.Struct({ value: Schema.Redacted(Schema.String) }),
      plain.pipe(
        Schema.middlewareEncoding<typeof plain, Encoding>((encoding) =>
          Encoding.pipe(Effect.flatMap(() => encoding)),
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
        // SAFETY: A required encoder is deliberately omitted to verify the synchronous configuration-error boundary.
        /* oxlint-disable typescript/no-unsafe-type-assertion */
        expect(() =>
          createHttpApiQueryUtils(contract, {
            client: unusedHttpClientFor(contract),
            keyPrefix: ['test'],
          } as never),
        ).toThrow(expect.objectContaining({ code: 'MissingKeyEncoder' }))
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        let received: unknown
        // SAFETY: This mock records arbitrary invocation values so request ownership can be asserted without changing the input.
        /* oxlint-disable anti-slop/no-unknown-parameters, typescript/no-unsafe-type-assertion */
        const safe = createHttpApiQueryUtils(contract, {
          client: unusedHttpClientFor(contract),
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
        /* oxlint-enable anti-slop/no-unknown-parameters, typescript/no-unsafe-type-assertion */
        const input = { [part]: { value: Redacted.make('secret') } }
        // SAFETY: This mock records arbitrary invocation values so request ownership can be asserted without changing the input.
        /* oxlint-disable anti-slop/no-unknown-parameters */
        expect(
          (safe.requests.save.queryKey as (input: unknown) => readonly unknown[])(input).at(-1),
        ).toStrictEqual({ identity: 'public-id' })
        /* oxlint-enable anti-slop/no-unknown-parameters */
        expect(received).toBe(input)
      }
    }
  })
})
