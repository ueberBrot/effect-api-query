import { exampleHttpApi, exampleRpcGroup } from '@effect-api-query/contracts'
import { startExampleRpcClient } from '@effect-api-query/contracts/client'
import type { ExampleRpcClient } from '@effect-api-query/contracts/client'
import { QueryClient } from '@tanstack/react-query'
import { ManagedRuntime } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import type { RpcClientError } from 'effect/rpc'

import { makeUserWrites } from './user-writes.ts'

const makeExampleRpcQueryUtils = (client: ExampleRpcClient, runPromiseExit: RunPromiseExit) =>
  createRpcQueryUtils<
    typeof exampleRpcGroup,
    readonly ['vite-react'],
    RpcClientError.RpcClientError
  >(exampleRpcGroup, {
    client,
    keyPrefix: ['vite-react'] as const,
    runPromiseExit,
  })

export type ExampleRpcQueryUtils = ReturnType<typeof makeExampleRpcQueryUtils>

const makeExampleHttpQueryUtils = (
  client: HttpApiClient.ForApi<typeof exampleHttpApi>,
  runPromiseExit: RunPromiseExit,
) => createHttpApiQueryUtils(exampleHttpApi, { client, keyPrefix: ['vite-react'], runPromiseExit })

export type ExampleHttpQueryUtils = ReturnType<typeof makeExampleHttpQueryUtils>

export interface ViteReactApplication {
  readonly httpQuery: ReturnType<typeof makeExampleHttpQueryUtils>
  readonly isActive: () => boolean
  readonly runMutation: <T>(execute: () => Promise<T>) => Promise<T>
  readonly userWrites: ReturnType<typeof makeUserWrites>
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
  const isActive = () => disposal === undefined
  const runMutation = async <T>(execute: () => Promise<T>) => {
    if (!isActive()) {
      throw new Error('The application owner has retired')
    }
    return execute()
  }
  const dispose = async () => {
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
      isActive,
      runMutation,
      userWrites: makeUserWrites({ queryClient, rpcQuery, httpQuery, isActive, runMutation }),
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
