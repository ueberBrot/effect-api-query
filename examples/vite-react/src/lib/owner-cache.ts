import { User } from "@effect-api-query/contracts";
import type { QueryKey } from "@tanstack/react-query";
import type { QueryOwner } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";

const OwnerIdentity = Schema.Struct({
  tenantId: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  sessionGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  permissionGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type ApplicationOwnerIdentity = typeof OwnerIdentity.Type;
export type DirectoryStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;
const Directory = Schema.Array(Schema.Struct(User.fields));

const PersistedDirectory = Schema.fromJsonString(
  Schema.Struct({
    identity: OwnerIdentity,
    schemaVersion: Schema.Literal(2),
    keyVersion: Schema.Literal(1),
    directories: Schema.Array(
      Schema.Struct({
        adapter: Schema.Literals(["rpc", "http"]),
        data: Directory,
      })
    ),
  })
);

export const ownerKeyPrefix = (identity: ApplicationOwnerIdentity) => {
  const owner = Schema.decodeSync(OwnerIdentity)(identity);
  return [
    "vite-react",
    owner.tenantId,
    owner.userId,
    owner.sessionGeneration,
    owner.permissionGeneration,
  ] as const;
};

export const makeOwnerCache = ({
  identity,
  directoryKeys,
  storage,
  lifecycle,
}: {
  readonly identity: ApplicationOwnerIdentity;
  readonly directoryKeys: Readonly<Record<"rpc" | "http", QueryKey>>;
  readonly storage?: DirectoryStorage | undefined;
  readonly lifecycle: Pick<
    QueryOwner<unknown>,
    "queryClient" | "runMutation" | "dispose"
  >;
}) => {
  const { queryClient } = lifecycle;
  const owner = Object.freeze(Schema.decodeSync(OwnerIdentity)(identity));
  const storageKey = `effect-api-query:directory:${JSON.stringify(ownerKeyPrefix(owner))}`;
  const pendingMutations = new Set<Promise<unknown>>();
  let active = true;
  let retirement: Promise<void> | undefined;
  const isActive = () => active;
  const runMutation = async <T>(execute: () => Promise<T>): Promise<T> => {
    if (!active) {
      throw new Error("Owner is inactive");
    }
    const run = async () => {
      await Promise.resolve();
      return await execute();
    };
    const result = lifecycle.runMutation(run);
    pendingMutations.add(result);
    try {
      return await result;
    } finally {
      pendingMutations.delete(result);
    }
  };
  const trackMutationOptions = <
    Args extends unknown[],
    Data,
    Options extends object,
  >(
    options: Options & { readonly mutationFn: (...args: Args) => Promise<Data> }
  ): Omit<Options, "mutationFn" | "networkMode" | "retry"> & {
    readonly mutationFn: (...args: Args) => Promise<Data>;
    readonly networkMode: "always";
    readonly retry: false;
  } => ({
    ...options,
    networkMode: "always",
    retry: false,
    mutationFn: async (...args: Args) =>
      runMutation(async () => options.mutationFn(...args)),
  });
  const saveDirectory = () => {
    if (storage === undefined) {
      return;
    }
    if (pendingMutations.size > 0 || queryClient.isMutating() > 0) {
      storage.removeItem(storageKey);
      return;
    }
    const directories = (["rpc", "http"] as const).flatMap((adapter) => {
      const data = queryClient.getQueryData(directoryKeys[adapter]);
      return data === undefined
        ? []
        : [{ adapter, data: Schema.decodeUnknownSync(Directory)(data) }];
    });
    storage.setItem(
      storageKey,
      JSON.stringify({
        identity: owner,
        schemaVersion: 2,
        keyVersion: 1,
        directories,
      })
    );
  };
  const persistDirectory = () => {
    if (active) {
      saveDirectory();
    }
  };
  const restoreDirectory = () => {
    if (!active || storage === undefined) {
      return false;
    }
    const json = storage.getItem(storageKey);
    if (json === null) {
      return false;
    }
    try {
      const snapshot = Schema.decodeSync(PersistedDirectory)(json);
      if (
        JSON.stringify(ownerKeyPrefix(snapshot.identity)) !==
        JSON.stringify(ownerKeyPrefix(owner))
      ) {
        storage.removeItem(storageKey);
        return false;
      }
      for (const { adapter, data } of snapshot.directories) {
        queryClient.setQueryData(directoryKeys[adapter], data, {
          updatedAt: 0,
        });
      }
      return true;
    } catch {
      storage.removeItem(storageKey);
      return false;
    }
  };
  const retire = async ({
    discardPersistence = true,
  }: { readonly discardPersistence?: boolean } = {}) => {
    const wasActive = active;
    active = false;
    if (retirement !== undefined) {
      if (discardPersistence) {
        storage?.removeItem(storageKey);
      }
      await retirement;
      return;
    }
    retirement = (async () => {
      try {
        if (discardPersistence) {
          storage?.removeItem(storageKey);
        } else if (wasActive) {
          saveDirectory();
        }
      } finally {
        await lifecycle.dispose();
      }
    })();
    await retirement;
  };
  return {
    identity: owner,
    isActive,
    runMutation,
    trackMutationOptions,
    persistDirectory,
    restoreDirectory,
    retire,
  };
};
