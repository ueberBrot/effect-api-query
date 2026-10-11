import { User, UserPage } from '@effect-api-query/contracts'
import type {
  InfiniteData,
  MutationObserverOptions,
  QueryClient,
  QueryKey,
} from '@tanstack/react-query'

import type { ExampleHttpQueryUtils, ExampleRpcQueryUtils } from './application.ts'
import type { makeOwnerCache } from './owner-cache.ts'

export interface UserWriteOwner {
  readonly queryClient: QueryClient
  readonly rpcQuery: Pick<ExampleRpcQueryUtils, 'users'>
  readonly httpQuery: Pick<ExampleHttpQueryUtils, 'users'>
  readonly isActive: () => boolean
  readonly trackMutationOptions: ReturnType<typeof makeOwnerCache>['trackMutationOptions']
}

interface DirectorySnapshot {
  readonly rpcList: readonly User[] | undefined
  readonly httpList: readonly User[] | undefined
  readonly rpcPages: InfiniteData<UserPage> | undefined
  readonly httpPages: InfiniteData<UserPage> | undefined
}
const restoreList = (
  current: readonly User[] | undefined,
  snapshot: readonly User[] | undefined,
  id: number,
) => {
  const index = snapshot?.findIndex((user) => user.id === id) ?? -1
  const user = snapshot?.[index]
  if (
    current === undefined ||
    user === undefined ||
    current.some((existing) => existing.id === id)
  ) {
    return current
  }
  const positions = new Map<number, number>()
  for (const [currentIndex, existing] of current.entries()) {
    if (!positions.has(existing.id)) {
      positions.set(existing.id, currentIndex)
    }
  }
  const following = snapshot?.slice(index + 1).find((candidate) => positions.has(candidate.id))
  let position = 0
  for (const candidate of snapshot?.slice(0, index) ?? []) {
    const precedingIndex = positions.get(candidate.id)
    if (precedingIndex !== undefined) {
      position = precedingIndex + 1
    }
  }
  if (following !== undefined) {
    position = positions.get(following.id) ?? position
  }
  return [...current.slice(0, position), user, ...current.slice(position)]
}

export const makeUserWrites = ({
  queryClient,
  rpcQuery,
  httpQuery,
  isActive,
  trackMutationOptions,
}: UserWriteOwner) => {
  let nextWrite = 0
  const pending = new Set<number>()
  const pageWrites = new WeakMap<UserPage, Set<number>>()
  const rpcList = rpcQuery.users.list.queryKey()
  const httpList = httpQuery.users.list.queryKey()
  const listKeys = [rpcList, httpList]
  const listWrites = new WeakMap<
    object,
    { readonly dataUpdateCount: number; readonly writes: Set<number> }
  >()
  const listQuery = (queryKey: QueryKey) =>
    queryClient.getQueryCache().get(queryClient.defaultQueryOptions({ queryKey }).queryHash)
  const ownedList = (query: ReturnType<typeof listQuery>) => {
    const ownership = query === undefined ? undefined : listWrites.get(query)
    return query !== undefined && ownership?.dataUpdateCount === query.state.dataUpdateCount
      ? ownership
      : undefined
  }
  const rpcPages = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
  const httpPages = httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } })
  const cancel = async () => {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: rpcQuery.users.key() }),
      queryClient.cancelQueries({ queryKey: httpQuery.users.key() }),
    ])
  }
  const begin = async () => {
    if (!isActive()) {
      throw new Error('The application owner has retired')
    }
    nextWrite += 1
    const write = nextWrite
    pending.add(write)
    try {
      await cancel()
      if (!isActive()) {
        throw new Error('The application owner has retired')
      }
      return write
    } catch (error) {
      pending.delete(write)
      throw error
    }
  }
  const settle = async (write: number | undefined) => {
    if (write === undefined) {
      return
    }
    pending.delete(write)
    if (!isActive() || pending.size !== 0) {
      return
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: rpcQuery.users.key() }),
      queryClient.invalidateQueries({ queryKey: httpQuery.users.key() }),
    ])
  }
  const editList = (
    key: QueryKey,
    edit: (users: readonly User[]) => readonly User[],
    write: number,
    phase: 'optimistic' | 'settled',
  ) => {
    const query = listQuery(key)
    if (query?.state.data === undefined) {
      return
    }
    const writes = new Set(ownedList(query)?.writes)
    if (phase === 'optimistic') {
      writes.add(write)
    } else {
      writes.delete(write)
    }
    const dataUpdateCount = query.state.dataUpdateCount + 1
    queryClient.setQueryData<readonly User[]>(key, (users) =>
      users === undefined ? undefined : edit(users),
    )
    listWrites.set(query, { dataUpdateCount, writes })
  }
  const editPages = (edit: (data: InfiniteData<UserPage>) => InfiniteData<UserPage>) => {
    queryClient.setQueryData(rpcPages, (data) => (data === undefined ? undefined : edit(data)))
    queryClient.setQueryData(httpPages, (data) => (data === undefined ? undefined : edit(data)))
  }
  const releaseWrite = (write: number) => {
    for (const key of listKeys) {
      const query = listQuery(key)
      if (query !== undefined) {
        listWrites.get(query)?.writes.delete(write)
      }
    }
    for (const key of [rpcPages, httpPages]) {
      for (const page of queryClient.getQueryData(key)?.pages ?? []) {
        pageWrites.get(page)?.delete(write)
      }
    }
  }
  const patchPage = (
    page: UserPage,
    users: readonly User[],
    write: number,
    totalChange: number,
    phase: 'optimistic' | 'settled',
  ) => {
    const writes = new Set(pageWrites.get(page))
    const applied = phase === 'optimistic' || writes.delete(write)
    if (phase === 'optimistic') {
      writes.add(write)
    }
    const patched = new UserPage({
      users,
      total: page.total + (applied ? totalChange : 0),
      nextCursor: page.nextCursor,
    })
    if (writes.size !== 0) {
      pageWrites.set(patched, writes)
    }
    return patched
  }
  const restorePages = (
    current: InfiniteData<UserPage> | undefined,
    snapshot: InfiniteData<UserPage> | undefined,
    id: number,
    write: number,
  ) => {
    if (current === undefined || snapshot === undefined) {
      return current
    }
    return {
      ...current,
      pages: current.pages.map((page, pageIndex) =>
        pageWrites.get(page)?.has(write) === true
          ? patchPage(
              page,
              restoreList(page.users, snapshot.pages[pageIndex]?.users, id) ?? page.users,
              write,
              1,
              'settled',
            )
          : page,
      ),
    }
  }
  const replaceUser = (
    id: number,
    replacement: User | undefined,
    write: number,
    totalChange: number,
    phase: 'optimistic' | 'settled',
  ) => {
    for (const key of listKeys) {
      editList(
        key,
        (users) => {
          const retained = users.filter((user) => user.id !== id && user.id !== replacement?.id)
          if (replacement === undefined) {
            return retained
          }
          const index = users.findIndex((user) => user.id === id)
          return index === -1
            ? [...retained, replacement]
            : [...retained.slice(0, index), replacement, ...retained.slice(index)]
        },
        write,
        phase,
      )
    }
    editPages((data) => ({
      ...data,
      pages: data.pages.map((page, pageIndex) => {
        const index = page.users.findIndex((user) => user.id === id)
        const retained = page.users.filter((user) => user.id !== id && user.id !== replacement?.id)
        const append =
          replacement !== undefined &&
          pageIndex === data.pages.length - 1 &&
          page.nextCursor === null
        let users = retained
        if (replacement !== undefined && index !== -1) {
          users = [...retained.slice(0, index), replacement, ...retained.slice(index)]
        } else if (append) {
          users = [...retained, replacement]
        }
        return patchPage(page, users, write, totalChange, phase)
      }),
    }))
  }
  const created = async (user: User, write: number) => {
    if (!isActive()) {
      return
    }
    await cancel()
    if (!isActive()) {
      return
    }
    replaceUser(-write, user, write, 0, 'settled')
    queryClient.setQueryData(
      rpcQuery.users.get.queryKey({ id: user.id, locale: user.locale }),
      user,
    )
    queryClient.setQueryData(
      httpQuery.users.get.queryKey({ params: { id: user.id }, query: { locale: user.locale } }),
      user,
    )
  }
  const createFailed = (write: number | undefined) => {
    if (isActive() && write !== undefined) {
      replaceUser(-write, undefined, write, -1, 'settled')
    }
  }
  const startCreate = async (input: {
    readonly name: string
    readonly locale?: string | undefined
  }) => {
    const write = await begin()
    if (!isActive()) {
      pending.delete(write)
      throw new Error('The application owner has retired')
    }
    const temporaryId = -write
    replaceUser(
      temporaryId,
      new User({ id: temporaryId, name: input.name, locale: input.locale ?? 'en' }),
      write,
      1,
      'optimistic',
    )
    return {
      commit: async (user: User) => created(user, write),
      rollback: () => {
        createFailed(write)
      },
      settle: async () => settle(write),
    }
  }
  const createCallbacks: Pick<
    MutationObserverOptions<User, Error, object, Awaited<ReturnType<typeof startCreate>>>,
    'onSuccess' | 'onError' | 'onSettled'
  > = {
    onSuccess: async (user, _input, transaction) => transaction.commit(user),
    onError: (_error, _input, transaction) => transaction?.rollback(),
    onSettled: async (_data, _error, _input, transaction) => transaction?.settle(),
  }
  let deletionBaseline: DirectorySnapshot | undefined
  const deletionGroups = new Map<
    number,
    DirectorySnapshot & {
      readonly pending: Set<number>
      readonly applied: boolean
      readonly write: number
      succeeded: boolean
    }
  >()
  const finishDelete = (id: number, write: number | undefined, succeeded: boolean) => {
    if (write === undefined) {
      return
    }
    const group = deletionGroups.get(id)
    if (group === undefined) {
      return
    }
    group.succeeded ||= succeeded
    group.pending.delete(write)
    if (group.pending.size !== 0) {
      return
    }
    deletionGroups.delete(id)
    if (deletionGroups.size === 0) {
      deletionBaseline = undefined
    }
    if (group.succeeded) {
      releaseWrite(group.write)
      return
    }
    if (!isActive() || !group.applied) {
      return
    }
    for (const [key, snapshot] of [
      [rpcList, group.rpcList],
      [httpList, group.httpList],
    ] as const) {
      if (ownedList(listQuery(key))?.writes.has(group.write) === true) {
        editList(
          key,
          (current) => restoreList(current, snapshot, id) ?? current,
          group.write,
          'settled',
        )
      }
    }
    queryClient.setQueryData(rpcPages, (current) =>
      restorePages(current, group.rpcPages, id, group.write),
    )
    queryClient.setQueryData(httpPages, (current) =>
      restorePages(current, group.httpPages, id, group.write),
    )
  }
  const deleted = async (id: number, write: number) => {
    if (isActive()) {
      await cancel()
    }
    finishDelete(id, write, true)
  }
  const startDelete = async (id: number) => {
    const write = await begin()
    if (!isActive()) {
      pending.delete(write)
      throw new Error('The application owner has retired')
    }
    let group = deletionGroups.get(id)
    if (group === undefined) {
      const lists = [queryClient.getQueryData(rpcList), queryClient.getQueryData(httpList)]
      const pages = [queryClient.getQueryData(rpcPages), queryClient.getQueryData(httpPages)]
      const listSnapshot = (
        baseline: readonly User[] | undefined,
        current: readonly User[] | undefined,
        owned: boolean,
      ) => {
        const target = current?.find((user) => user.id === id)
        return owned && baseline !== undefined && baseline.some((user) => user.id === id)
          ? baseline.map((user) => (user.id === id ? (target ?? user) : user))
          : current
      }
      const pageSnapshot = (
        baseline: InfiniteData<UserPage> | undefined,
        current: InfiniteData<UserPage> | undefined,
      ) =>
        current === undefined
          ? undefined
          : {
              ...current,
              pages: current.pages.map((page, index) => {
                const users = listSnapshot(
                  baseline?.pages[index]?.users,
                  page.users,
                  (pageWrites.get(page)?.size ?? 0) !== 0,
                )
                return users === page.users
                  ? page
                  : new UserPage({
                      users: users ?? page.users,
                      total: page.total,
                      nextCursor: page.nextCursor,
                    })
              }),
            }
      deletionBaseline = {
        rpcList: listSnapshot(
          deletionBaseline?.rpcList,
          lists[0],
          (ownedList(listQuery(rpcList))?.writes.size ?? 0) !== 0,
        ),
        httpList: listSnapshot(
          deletionBaseline?.httpList,
          lists[1],
          (ownedList(listQuery(httpList))?.writes.size ?? 0) !== 0,
        ),
        rpcPages: pageSnapshot(deletionBaseline?.rpcPages, pages[0]),
        httpPages: pageSnapshot(deletionBaseline?.httpPages, pages[1]),
      }
      const applied =
        lists.some((users) => users?.some((user) => user.id === id) ?? false) ||
        pages.some(
          (data) => data?.pages.some((page) => page.users.some((user) => user.id === id)) ?? false,
        )
      group = {
        ...deletionBaseline,
        pending: new Set(),
        succeeded: false,
        applied,
        write,
      }
      deletionGroups.set(id, group)
      if (applied) {
        replaceUser(id, undefined, write, -1, 'optimistic')
      }
    }
    group.pending.add(write)
    return {
      commit: async () => deleted(id, write),
      rollback: () => {
        finishDelete(id, write, false)
      },
      settle: async () => settle(write),
    }
  }
  const deleteCallbacks: Pick<
    MutationObserverOptions<void, Error, object, Awaited<ReturnType<typeof startDelete>>>,
    'onSuccess' | 'onError' | 'onSettled'
  > = {
    onSuccess: async (_data, _input, transaction) => transaction.commit(),
    onError: (_error, _input, transaction) => transaction?.rollback(),
    onSettled: async (_data, _error, _input, transaction) => transaction?.settle(),
  }
  return {
    rpcCreate: () =>
      trackMutationOptions(
        rpcQuery.users.create.mutationOptions({ ...createCallbacks, onMutate: startCreate }),
      ),
    httpCreate: () =>
      trackMutationOptions(
        httpQuery.users.create.mutationOptions({
          ...createCallbacks,
          onMutate: async ({ payload }) => startCreate(payload),
        }),
      ),
    rpcDelete: () =>
      trackMutationOptions(
        rpcQuery.users.delete.mutationOptions({
          ...deleteCallbacks,
          onMutate: async ({ id }) => startDelete(id),
        }),
      ),
    httpDelete: () =>
      trackMutationOptions(
        httpQuery.users.delete.mutationOptions({
          ...deleteCallbacks,
          onMutate: async ({ params }) => startDelete(params.id),
        }),
      ),
  }
}
