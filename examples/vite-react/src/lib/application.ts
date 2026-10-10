import { exampleHttpApi, exampleRpcGroup } from '@effect-api-query/contracts'
import { startExampleRpcClient } from '@effect-api-query/contracts/client'
import type { ExampleRpcClient } from '@effect-api-query/contracts/client'
import { QueryClient } from '@tanstack/react-query'
import { ManagedRuntime } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'

import { makeOwnerCache, ownerKeyPrefix } from './owner-cache.ts'
import type { ApplicationOwnerIdentity, DirectoryStorage } from './owner-cache.ts'

const makeExampleRpcQueryUtils = (
  client: ExampleRpcClient,
  runPromiseExit: RunPromiseExit,
  keyPrefix: ReturnType<typeof ownerKeyPrefix>,
) =>
  createRpcQueryUtils(exampleRpcGroup, {
    client,
    keyPrefix,
    runPromiseExit,
  })

export type ExampleRpcQueryUtils = ReturnType<typeof makeExampleRpcQueryUtils>

const makeExampleHttpQueryUtils = (
  client: HttpApiClient.ForApi<typeof exampleHttpApi>,
  runPromiseExit: RunPromiseExit,
  keyPrefix: ReturnType<typeof ownerKeyPrefix>,
) => createHttpApiQueryUtils(exampleHttpApi, { client, keyPrefix, runPromiseExit })

export interface ViteReactApplication {
  readonly httpQuery: ReturnType<typeof makeExampleHttpQueryUtils>
  readonly invalidateUsers: () => Promise<void>
  readonly dispose: (options?: { readonly discardPersistence?: boolean }) => Promise<void>
  readonly identity: ApplicationOwnerIdentity
  readonly isActive: () => boolean
  readonly persistDirectory: () => void
  readonly runMutation: <T>(execute: () => Promise<T>) => Promise<T>
  readonly trackMutationOptions: ReturnType<typeof makeOwnerCache>['trackMutationOptions']
  readonly queryClient: QueryClient
  readonly rpcQuery: ExampleRpcQueryUtils
}

export interface StartViteReactApplicationOptions {
  readonly rpcUrl: string
  readonly httpBaseUrl?: string
  readonly identity?: ApplicationOwnerIdentity
  readonly directoryStorage?: DirectoryStorage
}

/** Creates clients, query utilities, and cleanup together so the example can be copied as a whole. */
export const startViteReactApplication = async ({
  rpcUrl,
  httpBaseUrl = new URL(rpcUrl, globalThis.location?.href).origin,
  identity = {
    tenantId: 'example-team',
    userId: 'example-user',
    sessionGeneration: 1,
    permissionGeneration: 1,
  },
  directoryStorage,
}: StartViteReactApplicationOptions): Promise<ViteReactApplication> => {
  const keyPrefix = ownerKeyPrefix(identity)
  const rpcClient = await startExampleRpcClient(rpcUrl)
  const httpRuntime = ManagedRuntime.make(FetchHttpClient.layer)
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false, networkMode: 'always' },
      queries: { retry: false },
    },
  })
  let owner: ReturnType<typeof makeOwnerCache> | undefined
  let disposal: Promise<void> | undefined
  const dispose = async (options?: { readonly discardPersistence?: boolean }) => {
    const retirement = owner === undefined ? queryClient.cancelQueries() : owner.retire(options)
    disposal ??= (async () => {
      try {
        await retirement
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
    const httpQuery = makeExampleHttpQueryUtils(httpClient, httpRuntime.runPromiseExit, keyPrefix)
    const rpcQuery = makeExampleRpcQueryUtils(rpcClient.client, rpcClient.runPromiseExit, keyPrefix)
    owner = makeOwnerCache({
      identity,
      queryClient,
      directoryKeys: {
        rpc: rpcQuery.users.list.queryKey(),
        http: httpQuery.users.list.queryKey(),
      },
      storage: directoryStorage,
    })
    owner.restoreDirectory()
    const capturedOwner = owner
    return {
      httpQuery,
      identity: capturedOwner.identity,
      isActive: capturedOwner.isActive,
      persistDirectory: capturedOwner.persistDirectory,
      runMutation: capturedOwner.runMutation,
      trackMutationOptions: capturedOwner.trackMutationOptions,
      invalidateUsers: async () => {
        if (!capturedOwner.isActive()) {
          return
        }
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

export const switchViteReactApplication = async (
  previous: ViteReactApplication,
  options: StartViteReactApplicationOptions,
): Promise<ViteReactApplication> => {
  await previous.dispose()
  return startViteReactApplication(options)
}
