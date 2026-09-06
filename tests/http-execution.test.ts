import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import { Cause, Context, Effect, Exit, Layer, Option, Schema } from 'effect'
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/unstable/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/unstable/httpapi'
import { describe, expect, it } from 'vite-plus/test'

import {
  createHttpApiQueryUtils,
  EffectHttpApiQueryError,
  type RunPromiseExit,
} from '#effect-api-query'

const BufferedApi = HttpApi.make('buffered').add(
  HttpApiGroup.make('responses').add(
    HttpApiEndpoint.get('text', '/text', {
      success: Schema.String.pipe(HttpApiSchema.asText()),
    }),
    HttpApiEndpoint.get('bytes', '/bytes', {
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    }),
    HttpApiEndpoint.get('headers', '/headers', {
      success: HttpApiSchema.WithHeaders(Schema.FiniteFromString, {
        'x-version': Schema.FiniteFromString,
      }),
    }),
  ),
)

class Credentials extends Context.Service<Credentials, { readonly token: string }>()(
  'HttpExecution/Credentials',
) {}

class Authentication extends HttpApiMiddleware.Service<Authentication>()(
  'HttpExecution/Authentication',
  { requiredForClient: true },
) {}

const FailureApi = HttpApi.make('failure').add(
  HttpApiGroup.make('actions').add(
    HttpApiEndpoint.get('read', '/failure/:scenario', {
      params: { scenario: Schema.String },
      success: Schema.FiniteFromString,
      error: Schema.TaggedStruct('Denied', { message: Schema.String }).pipe(
        HttpApiSchema.status(400),
      ),
    }).middleware(Authentication),
  ),
)

const privateToken = 'private-authentication-token'
const middlewareDefect = new Error('middleware defect')
const transportFailure = new Error('socket closed')

const makeFailureClient = (requests: Array<HttpClientRequest.HttpClientRequest>) =>
  Effect.runPromise(
    HttpApiClient.makeWith(FailureApi, {
      baseUrl: 'https://example.test',
      httpClient: HttpClient.make((request) => {
        requests.push(request)
        if (request.url.endsWith('/transport')) {
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause: transportFailure }),
            }),
          )
        }
        const response = request.url.endsWith('/declared')
          ? Response.json({ _tag: 'Denied', message: 'access denied' }, { status: 400 })
          : request.url.endsWith('/decode')
            ? Response.json({ unexpected: true })
            : request.url.endsWith('/malformed-error')
              ? Response.json({ unexpected: true }, { status: 400 })
              : request.url.endsWith('/status')
                ? new Response('unavailable', { status: 503 })
                : Response.json('42')
        return Effect.succeed(HttpClientResponse.fromWeb(request, response))
      }),
    }).pipe(
      Effect.provide(
        HttpApiMiddleware.layerClient(
          Authentication,
          Effect.fn('Authentication.client')(function* ({ request, next }) {
            const credentials = yield* Credentials
            if (request.url.endsWith('/defect')) return yield* Effect.die(middlewareDefect)
            if (request.url.endsWith('/interrupt')) return yield* Effect.interrupt
            return yield* next(HttpClientRequest.bearerToken(request, credentials.token))
          }),
        ).pipe(Layer.provide(Layer.succeed(Credentials, { token: privateToken }))),
      ),
    ),
  )

describe('HTTP execution', () => {
  it('uses the caller runner to decode serviceful middleware error responses', async () => {
    class ErrorTranslation extends Context.Service<ErrorTranslation, { readonly prefix: string }>()(
      'HttpExecution/ErrorTranslation',
    ) {}
    const errorSchema = Schema.String.pipe(
      Schema.middlewareDecoding<Schema.String, ErrorTranslation>(
        Effect.fn('ErrorTranslation.decode')(function* (decode) {
          const translation = yield* ErrorTranslation
          return Option.map(yield* decode, (value) => `${translation.prefix}${value}`)
        }),
      ),
      HttpApiSchema.status(403),
    )
    class Authorization extends HttpApiMiddleware.Service<Authorization>()(
      'HttpExecution/Authorization',
      { error: errorSchema },
    ) {}
    const api = HttpApi.make('translation').add(
      HttpApiGroup.make('account').add(
        HttpApiEndpoint.get('read', '/account', { success: Schema.String }).middleware(
          Authorization,
        ),
      ),
    )
    const client = await Effect.runPromise(
      HttpApiClient.makeWith(api, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(request, Response.json('denied', { status: 403 })),
          ),
        ),
      }),
    )
    const runPromiseExit: RunPromiseExit<ErrorTranslation> = (effect, options) =>
      Effect.runPromiseExit(
        effect.pipe(Effect.provideService(ErrorTranslation, { prefix: 'translated: ' })),
        options,
      )
    const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['test'], runPromiseExit })
    const queryClient = new QueryClient()
    try {
      await expect(queryClient.query(utils.account.read.queryOptions())).rejects.toMatchObject({
        _tag: 'EffectHttpApiQueryError',
        cause: { reasons: [{ _tag: 'Fail', error: 'translated: denied' }] },
      })
    } finally {
      queryClient.clear()
    }
  })

  it('preserves decoded text, bytes, and header-wrapped values for queries and mutations', async () => {
    const client = await Effect.runPromise(
      HttpApiClient.makeWith(BufferedApi, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request) => {
          const response = request.url.endsWith('/text')
            ? new Response('hello', { headers: { 'content-type': 'text/plain' } })
            : request.url.endsWith('/bytes')
              ? new Response(new Uint8Array([0, 128, 255]), {
                  headers: { 'content-type': 'application/octet-stream' },
                })
              : Response.json('42', { headers: { 'x-version': '7' } })
          return Effect.succeed(HttpClientResponse.fromWeb(request, response))
        }),
      }),
    )
    const utils = createHttpApiQueryUtils(BufferedApi, { client, keyPrefix: ['test'] })
    const queryClient = new QueryClient()
    try {
      expect(await queryClient.query(utils.responses.text.queryOptions())).toBe('hello')
      expect(await queryClient.query(utils.responses.bytes.queryOptions())).toEqual(
        new Uint8Array([0, 128, 255]),
      )
      const expectedHeaders = HttpApiSchema.withHeaders({ body: 42, headers: { 'x-version': 7 } })
      expect(await queryClient.query(utils.responses.headers.queryOptions())).toEqual(
        expectedHeaders,
      )
      expect(
        await new MutationObserver(queryClient, utils.responses.text.mutationOptions()).mutate(),
      ).toBe('hello')
      expect(
        await new MutationObserver(queryClient, utils.responses.bytes.mutationOptions()).mutate(),
      ).toEqual(new Uint8Array([0, 128, 255]))
      expect(
        await new MutationObserver(queryClient, utils.responses.headers.mutationOptions()).mutate(),
      ).toEqual(expectedHeaders)
    } finally {
      queryClient.clear()
    }
  })

  it.each([
    ['declared', [{ _tag: 'Fail', error: { _tag: 'Denied', message: 'access denied' } }]],
    ['decode', [{ _tag: 'Fail', error: { _tag: 'SchemaError' } }]],
    [
      'status',
      [{ _tag: 'Fail', error: { _tag: 'HttpClientError', reason: { _tag: 'DecodeError' } } }],
    ],
    [
      'malformed-error',
      [
        { _tag: 'Fail', error: { _tag: 'HttpClientError', reason: { _tag: 'StatusCodeError' } } },
        { _tag: 'Fail', error: { _tag: 'SchemaError' } },
      ],
    ],
    [
      'transport',
      [
        {
          _tag: 'Fail',
          error: {
            _tag: 'HttpClientError',
            reason: { _tag: 'TransportError', cause: transportFailure },
          },
        },
      ],
    ],
    ['defect', [{ _tag: 'Die', defect: middlewareDefect }]],
    ['interrupt', [{ _tag: 'Interrupt' }]],
  ] as const)(
    'preserves the original %s Cause in queries and mutations',
    async (scenario, reasons) => {
      const client = await makeFailureClient([])
      let originalCause: Cause.Cause<unknown> | undefined
      const runPromiseExit: RunPromiseExit = async (effect, options) => {
        const exit = await Effect.runPromiseExit(effect, options)
        if (Exit.isFailure(exit)) originalCause = exit.cause
        return exit
      }
      const utils = createHttpApiQueryUtils(FailureApi, {
        client,
        keyPrefix: ['test'],
        runPromiseExit,
      })
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      const input = { params: { scenario } }
      try {
        for (const operation of ['query', 'mutation'] as const) {
          const error: unknown = await (
            operation === 'query'
              ? queryClient.query(utils.actions.read.queryOptions({ input }))
              : new MutationObserver(queryClient, utils.actions.read.mutationOptions()).mutate(
                  input,
                )
          ).catch((error: unknown) => error)
          expect(error).toBeInstanceOf(EffectHttpApiQueryError)
          if (!(error instanceof EffectHttpApiQueryError)) throw error
          expect(error.cause).toBe(originalCause)
          expect(error.cause.reasons).toMatchObject(reasons)
          expect(error.cause.reasons).toHaveLength(reasons.length)
          expect(error).toMatchObject({
            apiId: 'failure',
            groupId: 'actions',
            endpoint: 'read',
            method: 'GET',
            operation,
          })
          expect(error.message).not.toContain(scenario)
          expect(error.message).not.toContain(privateToken)
          expect(Object.keys(error).sort()).toEqual([
            '_tag',
            'apiId',
            'cause',
            'endpoint',
            'groupId',
            'method',
            'name',
            'operation',
          ])
        }
      } finally {
        queryClient.clear()
      }
    },
  )

  it('keeps middleware context and headers, and supplies a runner signal only for queries', async () => {
    const requests: Array<HttpClientRequest.HttpClientRequest> = []
    const client = await makeFailureClient(requests)
    const runnerOptions: Array<{ readonly signal?: AbortSignal } | undefined> = []
    const runPromiseExit: RunPromiseExit = (effect, options) => {
      runnerOptions.push(options)
      return Effect.runPromiseExit(effect, options)
    }
    const utils = createHttpApiQueryUtils(FailureApi, {
      client,
      keyPrefix: ['test'],
      runPromiseExit,
    })
    const queryClient = new QueryClient()
    const input = { params: { scenario: 'success' } }
    try {
      expect(await queryClient.query(utils.actions.read.queryOptions({ input }))).toBe(42)
      expect(
        await new MutationObserver(queryClient, utils.actions.read.mutationOptions()).mutate(input),
      ).toBe(42)
      expect(requests.map((request) => request.headers['authorization'])).toEqual([
        `Bearer ${privateToken}`,
        `Bearer ${privateToken}`,
      ])
      expect(runnerOptions[0]?.signal).toBeInstanceOf(AbortSignal)
      expect(runnerOptions[1]).toBeUndefined()
    } finally {
      queryClient.clear()
    }
  })

  it('passes runner rejections through for queries and mutations', async () => {
    const client = await makeFailureClient([])
    const rejection = new Error('runner rejected')
    const utils = createHttpApiQueryUtils(FailureApi, {
      client,
      keyPrefix: ['test'],
      runPromiseExit: (): Promise<never> => Promise.reject(rejection),
    })
    const queryClient = new QueryClient()
    const input = { params: { scenario: 'success' } }
    try {
      await expect(queryClient.query(utils.actions.read.queryOptions({ input }))).rejects.toBe(
        rejection,
      )
      await expect(
        new MutationObserver(queryClient, utils.actions.read.mutationOptions()).mutate(input),
      ).rejects.toBe(rejection)
    } finally {
      queryClient.clear()
    }
  })

  it.each(['onMutate', 'onSuccess'] as const)(
    'passes mutation %s callback failures through unchanged',
    async (callback) => {
      const client = await makeFailureClient([])
      const utils = createHttpApiQueryUtils(FailureApi, { client, keyPrefix: ['test'] })
      const queryClient = new QueryClient()
      const rejection = new Error(`${callback} failed`)
      const mutation = new MutationObserver(
        queryClient,
        utils.actions.read.mutationOptions({
          [callback]: () => {
            throw rejection
          },
        }),
      )
      try {
        await expect(mutation.mutate({ params: { scenario: 'success' } })).rejects.toBe(rejection)
      } finally {
        queryClient.clear()
      }
    },
  )

  it('leaves query selector errors to TanStack while caching the decoded response', async () => {
    const client = await makeFailureClient([])
    const utils = createHttpApiQueryUtils(FailureApi, { client, keyPrefix: ['test'] })
    const queryClient = new QueryClient()
    const rejection = new Error('selection failed')
    const options = utils.actions.read.queryOptions({
      input: { params: { scenario: 'success' } },
      select: () => {
        throw rejection
      },
    })
    const observer = new QueryObserver(queryClient, options)
    const unsubscribe = observer.subscribe(() => {})
    try {
      const result = await observer.refetch()
      expect(result.error).toBe(rejection)
      expect(queryClient.getQueryData(options.queryKey)).toBe(42)
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })
})
