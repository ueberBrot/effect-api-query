import { exampleHttpApi, exampleRpcGroup } from '@effect-api-query/contracts'
import { type ExampleRpcClient, startExampleRpcClient } from '@effect-api-query/contracts/client'
import { QueryClient } from '@tanstack/react-query'
import { ManagedRuntime } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils, type RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'

const makeExampleRpcQueryUtils = (client: ExampleRpcClient, runPromiseExit: RunPromiseExit) =>
  createRpcQueryUtils(exampleRpcGroup, {
    client,
    keyPrefix: ['vite-react'] as const,
    runPromiseExit,
  })

export type ExampleRpcQueryUtils = ReturnType<typeof makeExampleRpcQueryUtils>

const makeExampleHttpQueryUtils = (
  client: HttpApiClient.ForApi<typeof exampleHttpApi>,
  runPromiseExit: RunPromiseExit,
) => createHttpApiQueryUtils(exampleHttpApi, { client, keyPrefix: ['vite-react'], runPromiseExit })

export interface ViteReactApplication {
  readonly httpQuery: ReturnType<typeof makeExampleHttpQueryUtils>
  readonly invalidateUsers: () => Promise<void>
  readonly dispose: () => Promise<void>
  readonly queryClient: QueryClient
  readonly rpcQuery: ExampleRpcQueryUtils
}

export interface StartViteReactApplicationOptions {
  readonly rpcUrl: string
  readonly httpBaseUrl?: string
}

/** Creates clients, query utilities, and cleanup together so the example can be copied as a whole. */
export const startViteReactApplication = async ({
  rpcUrl,
  httpBaseUrl = new URL(rpcUrl, globalThis.location?.href).origin,
}: StartViteReactApplicationOptions): Promise<ViteReactApplication> => {
  const rpcClient = await startExampleRpcClient(rpcUrl)
  const httpRuntime = ManagedRuntime.make(FetchHttpClient.layer)
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
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
          HttpClientRequest.setHeader('x-example-authorization', 'allowed'),
        ),
      }),
    )
    const httpQuery = makeExampleHttpQueryUtils(httpClient, httpRuntime.runPromiseExit)
    const rpcQuery = makeExampleRpcQueryUtils(rpcClient.client, rpcClient.runPromiseExit)
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
