import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import type { Cause } from 'effect'
import { Context, Effect, Exit, Layer, Option, Schema } from 'effect'
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from 'effect/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api'
import { describe, expect, it } from 'vite-plus/test'

import { createHttpApiQueryUtils, EffectHttpApiQueryError } from '#effect-api-query'
import type { RunPromiseExit } from '#effect-api-query'

import { captureFailure } from './fixtures/async'

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

const makeFailureClient = async (requests: HttpClientRequest.HttpClientRequest[]) =>
  await Effect.runPromise(
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
        if (request.url.endsWith('/declared')) {
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({ _tag: 'Denied', message: 'access denied' }, { status: 400 }),
            ),
          )
        }
        if (request.url.endsWith('/decode')) {
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, Response.json({ unexpected: true })),
          )
        }
        if (request.url.endsWith('/malformed-error')) {
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({ unexpected: true }, { status: 400 }),
            ),
          )
        }
        if (request.url.endsWith('/status')) {
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, new Response('unavailable', { status: 503 })),
          )
        }
        return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json('42')))
      }),
    }).pipe(
      Effect.provide(
        HttpApiMiddleware.layerClient(
          Authentication,
          Effect.fn('Authentication.client')(function* ({ request, next }) {
            const credentials = yield* Credentials
            if (request.url.endsWith('/defect')) {
              return yield* Effect.die(middlewareDefect)
            }
            if (request.url.endsWith('/interrupt')) {
              return yield* Effect.interrupt
            }
            return yield* next(HttpClientRequest.bearerToken(request, credentials.token))
          }),
        ).pipe(Layer.provide(Layer.succeed(Credentials, { token: privateToken }))),
      ),
    ),
  )

describe('HTTP execution', () => {
  it('preserves group and top-level receivers of caller-provided ready client methods', async () => {
    const api = HttpApi.make('receivers').add(
      HttpApiGroup.make('grouped').add(
        HttpApiEndpoint.get('read', '/grouped/:id', {
          params: { id: Schema.String },
          success: Schema.String,
        }),
      ),
      HttpApiGroup.make('root', { topLevel: true }).add(
        HttpApiEndpoint.get('readRoot', '/root/:id', {
          params: { id: Schema.String },
          success: Schema.String,
        }),
      ),
    )
    const readyClient = await Effect.runPromise(
      HttpApiClient.makeWith(api, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(request.url))),
        ),
      }),
    )
    interface Receiver {
      readonly delegate: typeof readyClient.grouped.read
    }
    const receivers: Receiver[] = []
    const grouped = {
      delegate: readyClient.grouped.read,
      read<Mode extends HttpApiEndpoint.ClientResponseMode>(
        this: Receiver,
        request: { readonly params: { readonly id: string }; readonly responseMode?: Mode },
      ) {
        receivers.push(this)
        return this.delegate(request)
      },
    }
    const client = {
      grouped,
      delegate: readyClient.readRoot,
      readRoot<Mode extends HttpApiEndpoint.ClientResponseMode>(
        this: Receiver,
        request: { readonly params: { readonly id: string }; readonly responseMode?: Mode },
      ) {
        receivers.push(this)
        return this.delegate(request)
      },
    } satisfies HttpApiClient.ForApi<typeof api> & Receiver
    const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['test'] })
    const queryClient = new QueryClient()
    try {
      await expect(
        queryClient.query(utils.grouped.read.queryOptions({ input: { params: { id: 'query' } } })),
      ).resolves.toBe('https://example.test/grouped/query')
      await expect(
        new MutationObserver(queryClient, utils.readRoot.mutationOptions()).mutate({
          params: { id: 'mutation' },
        }),
      ).resolves.toBe('https://example.test/root/mutation')
      expect(receivers[0]).toBe(grouped)
      expect(receivers[1]).toBe(client)
    } finally {
      queryClient.clear()
    }
  })

  it('uses the caller runner to decode serviceful middleware error responses', async () => {
    class ErrorTranslation extends Context.Service<ErrorTranslation, { readonly prefix: string }>()(
      'HttpExecution/ErrorTranslation',
    ) {}
    const errorSchema = Schema.String.pipe(
      Schema.middlewareDecoding<Schema.String, ErrorTranslation>(
        Effect.fn('ErrorTranslation.decode')(function* (decode) {
          const translation = yield* ErrorTranslation
          return (yield* decode).pipe(Option.map((value) => `${translation.prefix}${value}`))
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
    const runPromiseExit: RunPromiseExit<ErrorTranslation> = async (effect, options) =>
      await Effect.runPromiseExit(
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
          if (request.url.endsWith('/text')) {
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response('hello', { headers: { 'content-type': 'text/plain' } }),
              ),
            )
          }
          if (request.url.endsWith('/bytes')) {
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(new Uint8Array([0, 128, 255]), {
                  headers: { 'content-type': 'application/octet-stream' },
                }),
              ),
            )
          }
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json('42', { headers: { 'x-version': '7' } }),
            ),
          )
        }),
      }),
    )
    const utils = createHttpApiQueryUtils(BufferedApi, { client, keyPrefix: ['test'] })
    const queryClient = new QueryClient()
    try {
      await expect(queryClient.query(utils.responses.text.queryOptions())).resolves.toBe('hello')
      await expect(queryClient.query(utils.responses.bytes.queryOptions())).resolves.toStrictEqual(
        new Uint8Array([0, 128, 255]),
      )
      const expectedHeaders = HttpApiSchema.withHeaders({ body: 42, headers: { 'x-version': 7 } })
      await expect(
        queryClient.query(utils.responses.headers.queryOptions()),
      ).resolves.toStrictEqual(expectedHeaders)
      await expect(
        new MutationObserver(queryClient, utils.responses.text.mutationOptions()).mutate(),
      ).resolves.toBe('hello')
      await expect(
        new MutationObserver(queryClient, utils.responses.bytes.mutationOptions()).mutate(),
      ).resolves.toStrictEqual(new Uint8Array([0, 128, 255]))
      await expect(
        new MutationObserver(queryClient, utils.responses.headers.mutationOptions()).mutate(),
      ).resolves.toStrictEqual(expectedHeaders)
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
        if (Exit.isFailure(exit)) {
          originalCause = exit.cause
        }
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
          // SAFETY: Query and mutation runs share a Cause recorder; sequential execution isolates each identity assertion.
          /* oxlint-disable eslint/no-await-in-loop */
          const error: unknown = await captureFailure(
            operation === 'query'
              ? queryClient.query(utils.actions.read.queryOptions({ input }))
              : new MutationObserver(queryClient, utils.actions.read.mutationOptions()).mutate(
                  input,
                ),
          )
          /* oxlint-enable eslint/no-await-in-loop */
          expect(error).toBeInstanceOf(EffectHttpApiQueryError)
          if (!(error instanceof EffectHttpApiQueryError)) {
            throw error
          }
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
          expect(Object.keys(error).sort()).toStrictEqual([
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
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const client = await makeFailureClient(requests)
    const runnerOptions: ({ readonly signal?: AbortSignal } | undefined)[] = []
    const runPromiseExit: RunPromiseExit = async (effect, options) => {
      runnerOptions.push(options)
      return await Effect.runPromiseExit(effect, options)
    }
    const utils = createHttpApiQueryUtils(FailureApi, {
      client,
      keyPrefix: ['test'],
      runPromiseExit,
    })
    const queryClient = new QueryClient()
    const input = { params: { scenario: 'success' } }
    try {
      await expect(queryClient.query(utils.actions.read.queryOptions({ input }))).resolves.toBe(42)
      await expect(
        new MutationObserver(queryClient, utils.actions.read.mutationOptions()).mutate(input),
      ).resolves.toBe(42)
      expect(requests.map((request) => request.headers['authorization'])).toStrictEqual([
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
      runPromiseExit: async (): Promise<never> => await Promise.reject(rejection),
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
    async (lifecycle) => {
      const client = await makeFailureClient([])
      const utils = createHttpApiQueryUtils(FailureApi, { client, keyPrefix: ['test'] })
      const queryClient = new QueryClient()
      const rejection = new Error(`${lifecycle} failed`)
      const mutation = new MutationObserver(
        queryClient,
        utils.actions.read.mutationOptions({
          [lifecycle]: () => {
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
