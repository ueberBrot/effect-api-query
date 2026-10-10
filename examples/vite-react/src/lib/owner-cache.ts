import type {
  MutationFunction,
  MutationOptions,
  QueryClient,
  QueryKey,
} from '@tanstack/react-query'
import { Schema } from 'effect'

const OwnerIdentity = Schema.Struct({
  tenantId: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  sessionGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  permissionGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})

export type ApplicationOwnerIdentity = typeof OwnerIdentity.Type
export type DirectoryStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>
type TrackedMutationOptions<TData, TError, TVariables, TOnMutateResult> = MutationOptions<
  TData,
  TError,
  TVariables,
  TOnMutateResult
> & {
  readonly mutationFn: MutationFunction<TData, TVariables>
  readonly networkMode: 'always'
  readonly retry: false
}

const Directory = Schema.Array(
  Schema.Struct({ id: Schema.Int, name: Schema.String, locale: Schema.String }),
)

const PersistedDirectory = Schema.fromJsonString(
  Schema.Struct({
    identity: OwnerIdentity,
    schemaVersion: Schema.Literal(1),
    keyVersion: Schema.Literal(1),
    directories: Schema.Array(
      Schema.Struct({ adapter: Schema.Literals(['rpc', 'http']), data: Directory }),
    ),
  }),
)

export const ownerKeyPrefix = (identity: ApplicationOwnerIdentity) => {
  const owner = Schema.decodeSync(OwnerIdentity)(identity)
  return [
    'vite-react',
    owner.tenantId,
    owner.userId,
    owner.sessionGeneration,
    owner.permissionGeneration,
  ] as const
}

export const makeOwnerCache = ({
  identity,
  queryClient,
  directoryKeys,
  storage,
}: {
  readonly identity: ApplicationOwnerIdentity
  readonly queryClient: QueryClient
  readonly directoryKeys: Readonly<Record<'rpc' | 'http', QueryKey>>
  readonly storage?: DirectoryStorage | undefined
}) => {
  const owner = Object.freeze(Schema.decodeSync(OwnerIdentity)(identity))
  const storageKey = `effect-api-query:directory:${JSON.stringify(ownerKeyPrefix(owner))}`
  const pendingMutations = new Set<Promise<unknown>>()
  let active = true
  let retirement: Promise<void> | undefined
  const isActive = () => active
  const runMutation = async <T>(execute: () => Promise<T>): Promise<T> => {
    if (!active) {
      throw new Error('Owner is inactive')
    }
    const result = (async () => {
      await Promise.resolve()
      return execute()
    })()
    pendingMutations.add(result)
    try {
      return await result
    } finally {
      pendingMutations.delete(result)
    }
  }
  const trackMutationOptions = <TData, TError, TVariables = void, TOnMutateResult = unknown>(
    options: MutationOptions<TData, TError, TVariables, TOnMutateResult> & {
      readonly mutationFn: MutationFunction<TData, TVariables>
    },
  ): TrackedMutationOptions<TData, TError, TVariables, TOnMutateResult> => ({
    ...options,
    networkMode: 'always' as const,
    retry: false as const,
    mutationFn: async (...args: Parameters<MutationFunction<TData, TVariables>>) =>
      await runMutation(async () => await options.mutationFn(...args)),
  })
  const saveDirectory = () => {
    if (storage === undefined) {
      return
    }
    if (pendingMutations.size > 0 || queryClient.isMutating() > 0) {
      storage.removeItem(storageKey)
      return
    }
    const directories = (['rpc', 'http'] as const).flatMap((adapter) => {
      const data = queryClient.getQueryData(directoryKeys[adapter])
      return data === undefined
        ? []
        : [{ adapter, data: Schema.decodeUnknownSync(Directory)(data) }]
    })
    storage.setItem(
      storageKey,
      JSON.stringify({ identity: owner, schemaVersion: 1, keyVersion: 1, directories }),
    )
  }
  const persistDirectory = () => {
    if (active) {
      saveDirectory()
    }
  }
  const restoreDirectory = () => {
    if (!active || storage === undefined) {
      return false
    }
    const json = storage.getItem(storageKey)
    if (json === null) {
      return false
    }
    try {
      const snapshot = Schema.decodeSync(PersistedDirectory)(json)
      if (
        JSON.stringify(ownerKeyPrefix(snapshot.identity)) !== JSON.stringify(ownerKeyPrefix(owner))
      ) {
        storage.removeItem(storageKey)
        return false
      }
      for (const { adapter, data } of snapshot.directories) {
        queryClient.setQueryData(directoryKeys[adapter], data, { updatedAt: 0 })
      }
      return true
    } catch {
      storage.removeItem(storageKey)
      return false
    }
  }
  const retire = async ({
    discardPersistence = true,
  }: { readonly discardPersistence?: boolean } = {}) => {
    const wasActive = active
    active = false
    if (retirement !== undefined) {
      if (discardPersistence) {
        storage?.removeItem(storageKey)
      }
      return retirement
    }
    retirement = (async () => {
      try {
        if (discardPersistence) {
          storage?.removeItem(storageKey)
        } else if (wasActive) {
          saveDirectory()
        }
      } finally {
        try {
          await queryClient.cancelQueries()
        } finally {
          queryClient.clear()
          await Promise.allSettled(pendingMutations)
        }
      }
    })()
    return retirement
  }
  return {
    identity: owner,
    isActive,
    runMutation,
    trackMutationOptions,
    persistDirectory,
    restoreDirectory,
    retire,
  }
}
