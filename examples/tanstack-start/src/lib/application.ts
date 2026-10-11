import { exampleHttpApi, exampleRpcGroup } from '@effect-api-query/contracts'
import { startExampleRpcClient } from '@effect-api-query/contracts/client'
import type { ExampleRpcClient, StartedExampleRpcClient } from '@effect-api-query/contracts/client'
import { QueryClient } from '@tanstack/react-query'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils, fetchStreamSnapshot } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'

const makeExampleRpcQueryUtils = (
  client: ExampleRpcClient,
  runPromiseExit: RunPromiseExit,
  identity: string,
) =>
  createRpcQueryUtils(exampleRpcGroup, {
    client,
    keyPrefix: ['tanstack-start', identity] as const,
    runPromiseExit,
  })

export type ExampleRpcQueryUtils = ReturnType<typeof makeExampleRpcQueryUtils>

const makeExampleHttpQueryUtils = (
  client: HttpApiClient.ForApi<typeof exampleHttpApi>,
  runPromiseExit: RunPromiseExit,
  identity: string,
) =>
  createHttpApiQueryUtils(exampleHttpApi, {
    client,
    keyPrefix: ['tanstack-start', identity],
    runPromiseExit,
  })

export interface TanStackStartApplication {
  readonly runPreparation: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
  readonly captureSnapshot: typeof fetchStreamSnapshot
  readonly httpQuery: ReturnType<typeof makeExampleHttpQueryUtils>
  readonly invalidateUsers: () => Promise<void>
  readonly dispose: () => Promise<void>
  readonly queryClient: QueryClient
  readonly rpcQuery: ExampleRpcQueryUtils
}

export interface StartTanStackStartApplicationOptions {
  readonly rpcUrl: string
  readonly rpcClient?: StartedExampleRpcClient
  readonly fetch?: typeof globalThis.fetch
  readonly httpBaseUrl?: string
  readonly identity?: string
  readonly httpAuthorization?: string
}

export const startTanStackStartApplication = async ({
  rpcUrl,
  rpcClient: readyRpcClient,
  fetch: applicationFetch,
  identity = 'example',
  httpAuthorization = 'allowed',
  httpBaseUrl = new URL(rpcUrl, globalThis.location?.href).origin,
}: StartTanStackStartApplicationOptions): Promise<TanStackStartApplication> => {
  const rpcClient = readyRpcClient ?? (await startExampleRpcClient(rpcUrl))
  const httpRuntime = ManagedRuntime.make(
    applicationFetch === undefined
      ? FetchHttpClient.layer
      : FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, applicationFetch)),
        ),
  )
  const abort = new AbortController()
  const pendingWork = new Set<Promise<unknown>>()
  const trackWork = async <A>(execute: () => A | Promise<A>): Promise<A> => {
    abort.signal.throwIfAborted()
    const execution = Promise.resolve(execute())
    pendingWork.add(execution)
    try {
      return await execution
    } finally {
      pendingWork.delete(execution)
    }
  }
  const ownRunner =
    (runner: RunPromiseExit): RunPromiseExit =>
    async (effect, options) =>
      trackWork(async () => runner(effect, options))
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        retry: false,
        staleTime: 60_000,
        persister: async (queryFn, context) => trackWork(() => queryFn(context)),
      },
    },
  })
  const runPreparation: TanStackStartApplication['runPreparation'] = async (effect) =>
    trackWork(async () => Effect.runPromise(effect, { signal: abort.signal }))
  const captureSnapshot: typeof fetchStreamSnapshot = async (owner, options, controls = {}) => {
    if (owner !== queryClient) {
      throw new Error('Snapshot belongs to another request')
    }
    return await trackWork(async () =>
      fetchStreamSnapshot(owner, options, {
        ...controls,
        signal:
          controls.signal === undefined
            ? abort.signal
            : AbortSignal.any([abort.signal, controls.signal]),
      }),
    )
  }
  let disposal: Promise<void> | undefined
  const dispose = async () => {
    disposal ??= (async () => {
      try {
        abort.abort()
        await queryClient.cancelQueries()
        await Promise.allSettled(pendingWork)
      } finally {
        queryClient.clear()
        try {
          await httpRuntime.dispose()
        } finally {
          await rpcClient.dispose()
        }
      }
    })()
    return disposal
  }

  try {
    const httpClient = await httpRuntime.runPromise(
      HttpApiClient.make(exampleHttpApi, {
        baseUrl: httpBaseUrl,
        transformClient: HttpClient.mapRequest(
          HttpClientRequest.setHeader('x-example-authorization', httpAuthorization),
        ),
      }),
    )
    const httpQuery = makeExampleHttpQueryUtils(
      httpClient,
      ownRunner(httpRuntime.runPromiseExit),
      identity,
    )
    const rpcQuery = makeExampleRpcQueryUtils(
      rpcClient.client,
      ownRunner(rpcClient.runPromiseExit),
      identity,
    )
    return {
      captureSnapshot,
      runPreparation,
      httpQuery,
      invalidateUsers: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: rpcQuery.users.key() }),
          queryClient.invalidateQueries({ queryKey: httpQuery.users.key() }),
        ])
      },
      dispose,
      queryClient,
      rpcQuery,
    }
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Application startup and cleanup failed', {
        cause: cleanupError,
      })
    }
    throw error
  }
}

export const reportCleanupFailure = async (cleanup: Promise<void>): Promise<void> => {
  try {
    await cleanup
  } catch (error) {
    console.error('Start resource cleanup failed', error)
  }
}
