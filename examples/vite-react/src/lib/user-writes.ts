import {
  directoryLimits,
  SeedUser,
  User,
  UserPage,
} from "@effect-api-query/contracts";
import type {
  InfiniteData,
  MutationObserverOptions,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

import type {
  ExampleHttpQueryUtils,
  ExampleRpcQueryUtils,
} from "./application.ts";
import type { makeOwnerCache } from "./owner-cache.ts";

export interface UserWriteOwner {
  readonly queryClient: QueryClient;
  readonly rpcQuery: Pick<ExampleRpcQueryUtils, "users">;
  readonly httpQuery: Pick<ExampleHttpQueryUtils, "users">;
  readonly isActive: () => boolean;
  readonly invalidateUsers: () => Promise<void>;
  readonly trackMutationOptions: ReturnType<
    typeof makeOwnerCache
  >["trackMutationOptions"];
}

export const makeUsersInvalidator =
  ({
    queryClient,
    rpcQuery,
    httpQuery,
    isActive,
  }: Pick<
    UserWriteOwner,
    "queryClient" | "rpcQuery" | "httpQuery" | "isActive"
  >) =>
  async () => {
    if (!isActive()) {
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries(rpcQuery.users.queryFilter()),
      queryClient.invalidateQueries(httpQuery.users.queryFilter()),
    ]);
  };

type DeleteTarget = Pick<User, "id" | "revision">;

const matchesUser = (user: User, target: DeleteTarget) =>
  user.id === target.id && user.revision === target.revision;

const optimisticUser = (write: number) => ({
  id: -write,
  revision: "optimistic",
});

const deletionKey = ({ id, revision }: DeleteTarget) =>
  JSON.stringify([id, revision]);

interface DirectorySnapshot {
  readonly rpcList: readonly User[] | undefined;
  readonly httpList: readonly User[] | undefined;
  readonly rpcPages: InfiniteData<UserPage> | undefined;
  readonly httpPages: InfiniteData<UserPage> | undefined;
}
const restoreList = (
  current: readonly User[] | undefined,
  snapshot: readonly User[] | undefined,
  target: DeleteTarget
) => {
  const index = snapshot?.findIndex((user) => matchesUser(user, target)) ?? -1;
  const user = snapshot?.[index];
  if (
    current === undefined ||
    user === undefined ||
    current.some((existing) => existing.id === target.id)
  ) {
    return current;
  }
  const positions = new Map<number, number>();
  for (const [currentIndex, existing] of current.entries()) {
    if (!positions.has(existing.id)) {
      positions.set(existing.id, currentIndex);
    }
  }
  const following = snapshot
    ?.slice(index + 1)
    .find((candidate) => positions.has(candidate.id));
  let position = 0;
  for (const candidate of snapshot?.slice(0, index) ?? []) {
    const precedingIndex = positions.get(candidate.id);
    if (precedingIndex !== undefined) {
      position = precedingIndex + 1;
    }
  }
  if (following !== undefined) {
    position = positions.get(following.id) ?? position;
  }
  return [...current.slice(0, position), user, ...current.slice(position)];
};

export const makeUserWrites = ({
  queryClient,
  rpcQuery,
  httpQuery,
  isActive,
  invalidateUsers,
  trackMutationOptions,
}: UserWriteOwner) => {
  let nextWrite = 0;
  const pending = new Set<number>();
  const pageWrites = new WeakMap<UserPage, Set<number>>();
  const rpcList = rpcQuery.users.list.queryKey();
  const httpList = httpQuery.users.list.queryKey();
  const listKeys = [rpcList, httpList];
  const listWrites = new WeakMap<
    object,
    { readonly dataUpdateCount: number; readonly writes: Set<number> }
  >();
  const listQuery = (queryKey: QueryKey) =>
    queryClient
      .getQueryCache()
      .get(queryClient.defaultQueryOptions({ queryKey }).queryHash);
  const ownedList = (query: ReturnType<typeof listQuery>) => {
    const ownership = query === undefined ? undefined : listWrites.get(query);
    return query !== undefined &&
      ownership?.dataUpdateCount === query.state.dataUpdateCount
      ? ownership
      : undefined;
  };
  const rpcPages = rpcQuery.users.page.infiniteKey({
    input: { cursor: 0, pageSize: 4 },
  });
  const httpPages = httpQuery.users.page.infiniteKey({
    input: { query: { cursor: 0, pageSize: 4 } },
  });
  const cancel = async () => {
    await Promise.all([
      queryClient.cancelQueries(rpcQuery.users.queryFilter()),
      queryClient.cancelQueries(httpQuery.users.queryFilter()),
    ]);
  };
  const begin = async () => {
    if (!isActive()) {
      throw new Error("The application owner has retired");
    }
    nextWrite += 1;
    const write = nextWrite;
    pending.add(write);
    try {
      await cancel();
      if (!isActive()) {
        throw new Error("The application owner has retired");
      }
      return write;
    } catch (error) {
      pending.delete(write);
      throw error;
    }
  };
  const settle = async (write: number | undefined) => {
    if (write === undefined) {
      return;
    }
    pending.delete(write);
    if (!isActive() || pending.size !== 0) {
      return;
    }
    await invalidateUsers();
  };
  const editList = (
    key: QueryKey,
    edit: (users: readonly User[]) => readonly User[],
    write: number,
    phase: "optimistic" | "settled"
  ) => {
    const query = listQuery(key);
    if (query?.state.data === undefined) {
      return;
    }
    const writes = new Set(ownedList(query)?.writes);
    if (phase === "optimistic") {
      writes.add(write);
    } else {
      writes.delete(write);
    }
    const dataUpdateCount = query.state.dataUpdateCount + 1;
    queryClient.setQueryData<readonly User[]>(
      key,
      (users) =>
        users === undefined
          ? undefined
          : edit(users).slice(0, directoryLimits.previewSize),
      { updatedAt: query.state.dataUpdatedAt }
    );
    listWrites.set(query, { dataUpdateCount, writes });
  };
  const editPages = (
    edit: (
      data: InfiniteData<UserPage>,
      users: readonly User[] | undefined
    ) => InfiniteData<UserPage>
  ) => {
    queryClient.setQueryData(rpcPages, (data) =>
      data === undefined
        ? undefined
        : edit(data, queryClient.getQueryData(rpcList))
    );
    queryClient.setQueryData(httpPages, (data) =>
      data === undefined
        ? undefined
        : edit(data, queryClient.getQueryData(httpList))
    );
  };
  const releaseWrite = (write: number) => {
    for (const key of listKeys) {
      const query = listQuery(key);
      if (query !== undefined) {
        listWrites.get(query)?.writes.delete(write);
      }
    }
    for (const key of [rpcPages, httpPages]) {
      for (const page of queryClient.getQueryData(key)?.pages ?? []) {
        pageWrites.get(page)?.delete(write);
      }
    }
  };
  const patchPage = (
    page: UserPage,
    users: readonly User[],
    write: number,
    totalChange: number,
    phase: "optimistic" | "settled"
  ) => {
    const writes = new Set(pageWrites.get(page));
    const applied = phase === "optimistic" || writes.delete(write);
    if (phase === "optimistic") {
      writes.add(write);
    }
    const patched = new UserPage({
      users: users.slice(0, directoryLimits.maxPageSize),
      total: page.total + (applied ? totalChange : 0),
      nextCursor: page.nextCursor,
    });
    if (writes.size !== 0) {
      pageWrites.set(patched, writes);
    }
    return patched;
  };
  const restorePages = (
    current: InfiniteData<UserPage> | undefined,
    snapshot: InfiniteData<UserPage> | undefined,
    target: DeleteTarget,
    write: number
  ) => {
    if (current === undefined || snapshot === undefined) {
      return current;
    }
    return {
      ...current,
      pages: current.pages.map((page, pageIndex) =>
        pageWrites.get(page)?.has(write) === true
          ? patchPage(
              page,
              restoreList(
                page.users,
                snapshot.pages[pageIndex]?.users,
                target
              ) ?? page.users,
              write,
              1,
              "settled"
            )
          : page
      ),
    };
  };
  const replaceUser = (
    target: DeleteTarget,
    replacement: User | undefined,
    write: number,
    totalChange: number,
    phase: "optimistic" | "settled"
  ) => {
    const matches = (user: User) => matchesUser(user, target);
    for (const key of listKeys) {
      editList(
        key,
        (users) => {
          const retained = users.filter(
            (user) => !matches(user) && user.id !== replacement?.id
          );
          if (replacement === undefined) {
            return retained;
          }
          const index = users.findIndex(matches);
          return index === -1
            ? [...retained, replacement]
            : [
                ...retained.slice(0, index),
                replacement,
                ...retained.slice(index),
              ];
        },
        write,
        phase
      );
    }
    editPages((data, directory) => {
      if (target.id > 0) {
        const replaced = (user: User) =>
          user.id === target.id && user.revision !== target.revision;
        if (
          data.pages.some((page) => page.users.some(replaced)) ||
          (directory?.some(replaced) === true &&
            !data.pages.some((page) => page.users.some(matches)))
        ) {
          return data;
        }
      }
      return {
        ...data,
        pages: data.pages.map((page, pageIndex) => {
          const index = page.users.findIndex(matches);
          const retained = page.users.filter(
            (user) => !matches(user) && user.id !== replacement?.id
          );
          const append =
            replacement !== undefined &&
            pageIndex === data.pages.length - 1 &&
            page.nextCursor === null;
          let users = retained;
          if (replacement !== undefined && index !== -1) {
            users = [
              ...retained.slice(0, index),
              replacement,
              ...retained.slice(index),
            ];
          } else if (append) {
            users = [...retained, replacement];
          }
          return patchPage(page, users, write, totalChange, phase);
        }),
      };
    });
  };
  const created = async (user: User, write: number) => {
    if (!isActive()) {
      return;
    }
    await cancel();
    if (!isActive()) {
      return;
    }
    replaceUser(optimisticUser(write), user, write, 0, "settled");
    queryClient.setQueryData(
      rpcQuery.users.get.queryKey({
        input: { id: user.id, locale: user.locale },
      }),
      user
    );
    queryClient.setQueryData(
      httpQuery.users.get.queryKey({
        input: {
          params: { id: user.id },
          query: { locale: user.locale },
        },
      }),
      user
    );
  };
  const createFailed = (write: number | undefined) => {
    if (isActive() && write !== undefined) {
      replaceUser(optimisticUser(write), undefined, write, -1, "settled");
    }
  };
  const startCreate = async (input: {
    readonly name: string;
    readonly locale?: string | undefined;
  }) => {
    const { locale, name } = new SeedUser({
      name: input.name,
      locale: input.locale ?? "en",
    });
    const write = await begin();
    if (!isActive()) {
      pending.delete(write);
      throw new Error("The application owner has retired");
    }
    const temporary = optimisticUser(write);
    replaceUser(
      temporary,
      new User({
        ...temporary,
        name,
        locale: locale ?? "en",
      }),
      write,
      1,
      "optimistic"
    );
    return {
      commit: async (user: User) => {
        await created(user, write);
      },
      rollback: () => {
        createFailed(write);
      },
      settle: async () => {
        await settle(write);
      },
    };
  };
  const createCallbacks: Pick<
    MutationObserverOptions<
      User,
      Error,
      object,
      Awaited<ReturnType<typeof startCreate>>
    >,
    "onSuccess" | "onError" | "onSettled"
  > = {
    onSuccess: async (user, _input, transaction) => {
      await transaction.commit(user);
    },
    onError: (_error, _input, transaction) => transaction?.rollback(),
    onSettled: async (_data, _error, _input, transaction) => {
      await transaction?.settle();
    },
  };
  let deletionBaseline: DirectorySnapshot | undefined;
  const deletionGroups = new Map<
    string,
    DirectorySnapshot & {
      readonly pending: Set<number>;
      readonly applied: boolean;
      readonly write: number;
      succeeded: boolean;
    }
  >();
  const finishDelete = (
    target: DeleteTarget,
    write: number | undefined,
    succeeded: boolean
  ) => {
    if (write === undefined) {
      return;
    }
    const groupKey = deletionKey(target);
    const group = deletionGroups.get(groupKey);
    if (group === undefined) {
      return;
    }
    group.succeeded ||= succeeded;
    group.pending.delete(write);
    if (group.pending.size !== 0) {
      return;
    }
    deletionGroups.delete(groupKey);
    if (deletionGroups.size === 0) {
      deletionBaseline = undefined;
    }
    if (group.succeeded) {
      releaseWrite(group.write);
      return;
    }
    if (!isActive() || !group.applied) {
      return;
    }
    for (const [key, snapshot] of [
      [rpcList, group.rpcList],
      [httpList, group.httpList],
    ] as const) {
      if (ownedList(listQuery(key))?.writes.has(group.write) === true) {
        editList(
          key,
          (current) => restoreList(current, snapshot, target) ?? current,
          group.write,
          "settled"
        );
      }
    }
    queryClient.setQueryData(rpcPages, (current) =>
      restorePages(current, group.rpcPages, target, group.write)
    );
    queryClient.setQueryData(httpPages, (current) =>
      restorePages(current, group.httpPages, target, group.write)
    );
  };
  const deleted = async (target: DeleteTarget, write: number) => {
    if (isActive()) {
      await cancel();
    }
    finishDelete(target, write, true);
  };
  const startDelete = async (target: DeleteTarget) => {
    const matches = (user: User) => matchesUser(user, target);
    const write = await begin();
    if (!isActive()) {
      pending.delete(write);
      throw new Error("The application owner has retired");
    }
    const groupKey = deletionKey(target);
    let group = deletionGroups.get(groupKey);
    if (group === undefined) {
      const lists = [
        queryClient.getQueryData(rpcList),
        queryClient.getQueryData(httpList),
      ];
      const pages = [
        queryClient.getQueryData(rpcPages),
        queryClient.getQueryData(httpPages),
      ];
      const listSnapshot = (
        baseline: readonly User[] | undefined,
        current: readonly User[] | undefined,
        owned: boolean
      ) => {
        const currentTarget = current?.find(matches);
        return owned && baseline !== undefined && baseline.some(matches)
          ? baseline.map((user) =>
              matches(user) ? (currentTarget ?? user) : user
            )
          : current;
      };
      const pageSnapshot = (
        baseline: InfiniteData<UserPage> | undefined,
        current: InfiniteData<UserPage> | undefined
      ) =>
        current === undefined
          ? undefined
          : {
              ...current,
              pages: current.pages.map((page, index) => {
                const users = listSnapshot(
                  baseline?.pages[index]?.users,
                  page.users,
                  (pageWrites.get(page)?.size ?? 0) !== 0
                );
                return users === page.users
                  ? page
                  : new UserPage({
                      users: users ?? page.users,
                      total: page.total,
                      nextCursor: page.nextCursor,
                    });
              }),
            };
      deletionBaseline = {
        rpcList: listSnapshot(
          deletionBaseline?.rpcList,
          lists[0],
          (ownedList(listQuery(rpcList))?.writes.size ?? 0) !== 0
        ),
        httpList: listSnapshot(
          deletionBaseline?.httpList,
          lists[1],
          (ownedList(listQuery(httpList))?.writes.size ?? 0) !== 0
        ),
        rpcPages: pageSnapshot(deletionBaseline?.rpcPages, pages[0]),
        httpPages: pageSnapshot(deletionBaseline?.httpPages, pages[1]),
      };
      const applied =
        lists.some((users) => users?.some(matches) ?? false) ||
        pages.some(
          (data) =>
            data?.pages.some((page) => page.users.some(matches)) ?? false
        );
      group = {
        ...deletionBaseline,
        pending: new Set(),
        succeeded: false,
        applied,
        write,
      };
      deletionGroups.set(groupKey, group);
      if (applied) {
        replaceUser(target, undefined, write, -1, "optimistic");
      }
    }
    group.pending.add(write);
    return {
      commit: async () => {
        await deleted(target, write);
      },
      rollback: () => {
        finishDelete(target, write, false);
      },
      settle: async () => {
        await settle(write);
      },
    };
  };
  const deleteCallbacks: Pick<
    MutationObserverOptions<
      void,
      Error,
      object,
      Awaited<ReturnType<typeof startDelete>>
    >,
    "onSuccess" | "onError" | "onSettled"
  > = {
    onSuccess: async (_data, _input, transaction) => {
      await transaction.commit();
    },
    onError: (_error, _input, transaction) => transaction?.rollback(),
    onSettled: async (_data, _error, _input, transaction) => {
      await transaction?.settle();
    },
  };
  return {
    rpcCreate: () =>
      trackMutationOptions(
        rpcQuery.users.create.mutationOptions({
          ...createCallbacks,
          onMutate: startCreate,
        })
      ),
    httpCreate: () =>
      trackMutationOptions(
        httpQuery.users.create.mutationOptions({
          ...createCallbacks,
          onMutate: async ({ payload }) => await startCreate(payload),
        })
      ),
    rpcDelete: () =>
      trackMutationOptions(
        rpcQuery.users.delete.mutationOptions({
          ...deleteCallbacks,
          onMutate: startDelete,
        })
      ),
    httpDelete: () =>
      trackMutationOptions(
        httpQuery.users.delete.mutationOptions({
          ...deleteCallbacks,
          onMutate: async ({ params, query }) =>
            await startDelete({ ...params, ...query }),
        })
      ),
  };
};
