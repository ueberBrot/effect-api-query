import { User, UserPage } from '@effect-api-query/contracts'
import type { InfiniteData, MutationOptions, QueryClient } from '@tanstack/react-query'

import type { ExampleHttpQueryUtils, ExampleRpcQueryUtils } from './application.ts'

export interface UserWriteOwner {
  readonly queryClient: QueryClient
  readonly rpcQuery: Pick<ExampleRpcQueryUtils, 'users'>
  readonly httpQuery: Pick<ExampleHttpQueryUtils, 'users'>
  readonly isActive: () => boolean
  readonly runMutation: <T>(execute: () => Promise<T>) => Promise<T>
}

export interface CreateTransaction {
  readonly commit: (user: User) => Promise<void>
  readonly rollback: () => void
  readonly settle: () => Promise<void>
}
export interface DeleteTransaction {
  readonly commit: () => Promise<void>
  readonly rollback: () => void
  readonly settle: () => Promise<void>
}
interface DirectorySnapshot {
  readonly rpcList: readonly User[] | undefined
  readonly httpList: readonly User[] | undefined
  readonly rpcPages: InfiniteData<UserPage> | undefined
  readonly httpPages: InfiniteData<UserPage> | undefined
}
export type UserMutationOptions<Data, Failure, Input, Transaction> = MutationOptions<
  Data,
  Failure,
  Input,
  Transaction
> &
  Required<Pick<MutationOptions<Data, Failure, Input, Transaction>, 'mutationFn' | 'mutationKey'>>
export type RpcCreateOptions = ReturnType<
  ExampleRpcQueryUtils['users']['create']['mutationOptions']
>
export type HttpCreateOptions = ReturnType<
  ExampleHttpQueryUtils['users']['create']['mutationOptions']
>
export type RpcDeleteOptions = ReturnType<
  ExampleRpcQueryUtils['users']['delete']['mutationOptions']
>
export type HttpDeleteOptions = ReturnType<
  ExampleHttpQueryUtils['users']['delete']['mutationOptions']
>
export interface UserWrites {
  readonly rpcCreate: () => UserMutationOptions<
    User,
    Parameters<NonNullable<RpcCreateOptions['onError']>>[0],
    Parameters<RpcCreateOptions['mutationFn']>[0],
    CreateTransaction
  >
  readonly httpCreate: () => UserMutationOptions<
    User,
    Parameters<NonNullable<HttpCreateOptions['onError']>>[0],
    Parameters<HttpCreateOptions['mutationFn']>[0],
    CreateTransaction
  >
  readonly rpcDelete: () => UserMutationOptions<
    void,
    Parameters<NonNullable<RpcDeleteOptions['onError']>>[0],
    Parameters<RpcDeleteOptions['mutationFn']>[0],
    DeleteTransaction
  >
  readonly httpDelete: () => UserMutationOptions<
    void,
    Parameters<NonNullable<HttpDeleteOptions['onError']>>[0],
    Parameters<HttpDeleteOptions['mutationFn']>[0],
    DeleteTransaction
  >
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
  const following = snapshot
    ?.slice(index + 1)
    .find((candidate) => current.some((existing) => existing.id === candidate.id))
  let position = 0
  for (const candidate of snapshot?.slice(0, index) ?? []) {
    const precedingIndex = current.findIndex((existing) => existing.id === candidate.id)
    if (precedingIndex !== -1) {
      position = precedingIndex + 1
    }
  }
  if (following !== undefined) {
    position = current.findIndex((existing) => existing.id === following.id)
  }
  return [...current.slice(0, position), user, ...current.slice(position)]
}

const restorePages = (
  current: InfiniteData<UserPage> | undefined,
  snapshot: InfiniteData<UserPage> | undefined,
  id: number,
) => {
  if (current === undefined || snapshot === undefined) {
    return current
  }
  return {
    ...current,
    pages: current.pages.map((page, pageIndex) => {
      const before = snapshot.pages[pageIndex]
      const restored = restoreList(page.users, before?.users, id) ?? page.users
      return new UserPage({ users: restored, total: page.total + 1, nextCursor: page.nextCursor })
    }),
  }
}

export const makeUserWrites = ({
  queryClient,
  rpcQuery,
  httpQuery,
  isActive,
  runMutation,
}: UserWriteOwner): UserWrites => {
  let nextWrite = 0
  const pending = new Set<number>()
  const rpcList = rpcQuery.users.list.queryKey()
  const httpList = httpQuery.users.list.queryKey()
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
  const editLists = (edit: (users: readonly User[]) => readonly User[]) => {
    queryClient.setQueryData(rpcList, (users) => (users === undefined ? undefined : edit(users)))
    queryClient.setQueryData(httpList, (users) => (users === undefined ? undefined : edit(users)))
  }
  const editPages = (edit: (data: InfiniteData<UserPage>) => InfiniteData<UserPage>) => {
    queryClient.setQueryData(rpcPages, (data) => (data === undefined ? undefined : edit(data)))
    queryClient.setQueryData(httpPages, (data) => (data === undefined ? undefined : edit(data)))
  }
  const replaceUser = (id: number, replacement: User | undefined, totalChange: number) => {
    editLists((users) => {
      const retained = users.filter((user) => user.id !== id && user.id !== replacement?.id)
      if (replacement === undefined) {
        return retained
      }
      const index = users.findIndex((user) => user.id === id)
      return index === -1
        ? [...retained, replacement]
        : [...retained.slice(0, index), replacement, ...retained.slice(index)]
    })
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
        return new UserPage({ nextCursor: page.nextCursor, users, total: page.total + totalChange })
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
    replaceUser(-write, user, 0)
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
      replaceUser(-write, undefined, -1)
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
      1,
    )
    return {
      commit: async (user: User) => created(user, write),
      rollback: () => {
        createFailed(write)
      },
      settle: async () => settle(write),
    }
  }
  const rpcCreate = () => {
    const options = rpcQuery.users.create.mutationOptions({
      networkMode: 'always',
      retry: false,
      onMutate: startCreate,
      onSuccess: async (user, _input, transaction) => transaction.commit(user),
      onError: (_error, _input, transaction) => {
        transaction?.rollback()
      },
      onSettled: async (_data, _error, _input, transaction) => transaction?.settle(),
    })
    return {
      ...options,
      mutationFn: async (...args: Parameters<typeof options.mutationFn>) =>
        runMutation(async () => options.mutationFn(...args)),
    }
  }
  const httpCreate = () => {
    const options = httpQuery.users.create.mutationOptions({
      networkMode: 'always',
      retry: false,
      onMutate: async ({ payload }) => startCreate(payload),
      onSuccess: async (user, _input, transaction) => transaction.commit(user),
      onError: (_error, _input, transaction) => {
        transaction?.rollback()
      },
      onSettled: async (_data, _error, _input, transaction) => transaction?.settle(),
    })
    return {
      ...options,
      mutationFn: async (...args: Parameters<typeof options.mutationFn>) =>
        runMutation(async () => options.mutationFn(...args)),
    }
  }
  let deletionBaseline: DirectorySnapshot | undefined
  const deletionGroups = new Map<
    number,
    DirectorySnapshot & {
      readonly pending: Set<number>
      readonly applied: boolean
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
    if (!isActive() || group.succeeded || !group.applied) {
      return
    }
    queryClient.setQueryData(rpcList, (current) => restoreList(current, group.rpcList, id))
    queryClient.setQueryData(httpList, (current) => restoreList(current, group.httpList, id))
    queryClient.setQueryData(rpcPages, (current) => restorePages(current, group.rpcPages, id))
    queryClient.setQueryData(httpPages, (current) => restorePages(current, group.httpPages, id))
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
      deletionBaseline ??= {
        rpcList: lists[0],
        httpList: lists[1],
        rpcPages: pages[0],
        httpPages: pages[1],
      }
      const listSnapshot = (
        baseline: readonly User[] | undefined,
        current: readonly User[] | undefined,
      ) => ((baseline?.some((user) => user.id === id) ?? false) ? baseline : current)
      const pageSnapshot = (
        baseline: InfiniteData<UserPage> | undefined,
        current: InfiniteData<UserPage> | undefined,
      ) =>
        (baseline?.pages.some((page) => page.users.some((user) => user.id === id)) ?? false)
          ? baseline
          : current
      const applied =
        lists.some((users) => users?.some((user) => user.id === id) ?? false) ||
        pages.some(
          (data) => data?.pages.some((page) => page.users.some((user) => user.id === id)) ?? false,
        )
      group = {
        pending: new Set(),
        succeeded: false,
        applied,
        rpcList: listSnapshot(deletionBaseline.rpcList, lists[0]),
        httpList: listSnapshot(deletionBaseline.httpList, lists[1]),
        rpcPages: pageSnapshot(deletionBaseline.rpcPages, pages[0]),
        httpPages: pageSnapshot(deletionBaseline.httpPages, pages[1]),
      }
      deletionGroups.set(id, group)
      if (applied) {
        replaceUser(id, undefined, -1)
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
  const rpcDelete = () => {
    const options = rpcQuery.users.delete.mutationOptions({
      networkMode: 'always',
      retry: false,
      onMutate: async ({ id }) => startDelete(id),
      onSuccess: async (_data, _input, transaction) => transaction.commit(),
      onError: (_error, _input, transaction) => {
        transaction?.rollback()
      },
      onSettled: async (_data, _error, _input, transaction) => transaction?.settle(),
    })
    return {
      ...options,
      mutationFn: async (...args: Parameters<typeof options.mutationFn>) =>
        runMutation(async () => options.mutationFn(...args)),
    }
  }
  const httpDelete = () => {
    const options = httpQuery.users.delete.mutationOptions({
      networkMode: 'always',
      retry: false,
      onMutate: async ({ params }) => startDelete(params.id),
      onSuccess: async (_data, _input, transaction) => transaction.commit(),
      onError: (_error, _input, transaction) => {
        transaction?.rollback()
      },
      onSettled: async (_data, _error, _input, transaction) => transaction?.settle(),
    })
    return {
      ...options,
      mutationFn: async (...args: Parameters<typeof options.mutationFn>) =>
        runMutation(async () => options.mutationFn(...args)),
    }
  }
  return { rpcCreate, httpCreate, rpcDelete, httpDelete }
}
