import { exampleHttpApi, exampleRpcGroup } from '@effect-api-query/contracts'
import { type ExampleRpcClient, startExampleRpcClient } from '@effect-api-query/contracts/client'
import { QueryClient } from '@tanstack/react-query'
import { ManagedRuntime } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils, type RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'

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
  readonly httpQuery: ReturnType<typeof makeExampleHttpQueryUtils>
  readonly invalidateUsers: () => Promise<void>
  readonly dispose: () => Promise<void>
  readonly queryClient: QueryClient
  readonly rpcQuery: ExampleRpcQueryUtils
}

export interface StartTanStackStartApplicationOptions {
  readonly rpcUrl: string
  readonly httpBaseUrl?: string
  readonly identity?: string
  readonly httpAuthorization?: string
}

/** Keeps the complete, caller-owned integration visible at the application seam. */
export const startTanStackStartApplication = async ({
  rpcUrl,
  identity = 'example',
  httpAuthorization = 'allowed',
  httpBaseUrl = new URL(rpcUrl, globalThis.location?.href).origin,
}: StartTanStackStartApplicationOptions): Promise<TanStackStartApplication> => {
  const rpcClient = await startExampleRpcClient(rpcUrl)
  const httpRuntime = ManagedRuntime.make(FetchHttpClient.layer)
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, staleTime: 60_000 },
    },
  })
  let disposal: Promise<void> | undefined
  const dispose = () => {
    // Stop queries before releasing the ready clients they execute through.
    disposal ??= (async () => {
      try {
        await queryClient.cancelQueries()
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
    const httpQuery = makeExampleHttpQueryUtils(httpClient, httpRuntime.runPromiseExit, identity)
    const rpcQuery = makeExampleRpcQueryUtils(rpcClient.client, rpcClient.runPromiseExit, identity)
    return {
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
  } catch (cause) {
    try {
      await dispose()
    } catch (cleanupCause) {
      throw new AggregateError([cause, cleanupCause], 'Application startup and cleanup failed')
    }
    throw cause
  }
}
