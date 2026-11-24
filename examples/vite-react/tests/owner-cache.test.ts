import { MutationObserver, onlineManager } from "@tanstack/react-query";
import { acquireQueryOwner } from "@ueberbrot/effect-api-query";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeOwnerCache, ownerKeyPrefix } from "../src/lib/owner-cache.ts";

const identity = {
  tenantId: "team-a",
  userId: "user-a",
  sessionGeneration: 3,
  permissionGeneration: 7,
};

const makeStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
};

const makeCache = async (
  storage: ReturnType<typeof makeStorage>,
  owner = identity
) => {
  const prefix = ownerKeyPrefix(owner);
  const lifecycle = await acquireQueryOwner(
    async () => await Promise.resolve(null)
  );
  return {
    queryClient: lifecycle.queryClient,
    ...makeOwnerCache({
      identity: owner,
      lifecycle,
      directoryKeys: {
        rpc: [...prefix, "rpc", "users", "list", "query"],
        http: [...prefix, "http", "users", "list", "query"],
      },
      storage,
    }),
  };
};

describe("application private cache owner", () => {
  it("attempts accepted native writes without leaving an offline queue on owner handoff", async () => {
    const owner = await makeCache(makeStorage());
    const { queryClient } = owner;
    const mutation = new MutationObserver(
      queryClient,
      owner.trackMutationOptions({
        mutationFn: async () => await Promise.resolve(4),
      })
    );
    onlineManager.setOnline(false);
    const result = mutation.mutate();
    try {
      await vi.waitFor(() => {
        expect(mutation.getCurrentResult().status).toBe("success");
      });
      await expect(result).resolves.toBe(4);
      await owner.retire();
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    } finally {
      onlineManager.setOnline(true);
      await queryClient.resumePausedMutations();
      await result;
      await owner.retire();
    }
  });

  it("drains an accepted native mutation and rejects new native work after retirement", async () => {
    const stored = makeStorage();
    const owner = await makeCache(stored);
    const { queryClient } = owner;
    queryClient.setQueryData(
      [...ownerKeyPrefix(identity), "rpc", "users", "list", "query"],
      [{ id: 1, revision: "user-1", name: "Ada", locale: "en" }]
    );
    owner.persistDirectory();
    expect(stored.values.size).toBe(1);
    const entered = Deferred.makeUnsafe<boolean>();
    const release = Deferred.makeUnsafe<number>();
    const mutation = new MutationObserver(
      queryClient,
      owner.trackMutationOptions({
        mutationFn: async () => {
          await Effect.runPromise(Deferred.succeed(entered, true));
          return await Effect.runPromise(Deferred.await(release));
        },
      })
    );
    const result = mutation.mutate();
    await Effect.runPromise(Deferred.await(entered));
    owner.persistDirectory();
    expect(stored.values.size).toBe(0);
    const retiring = owner.retire();
    await Effect.runPromise(Deferred.succeed(release, 4));
    await expect(result).resolves.toBe(4);
    await retiring;
    const late = new MutationObserver(
      queryClient,
      owner.trackMutationOptions({
        mutationFn: async () => await Promise.resolve(5),
      })
    );
    await expect(late.mutate()).rejects.toThrow("Owner is inactive");
    queryClient.clear();
  });

  it("preserves an explicit reload snapshot while retiring its old in-memory owner", async () => {
    const storage = makeStorage();
    const owner = await makeCache(storage);
    const { queryClient } = owner;
    const key = [...ownerKeyPrefix(identity), "rpc", "users", "list", "query"];
    queryClient.setQueryData(key, [
      { id: 2, revision: "user-2", name: "Grace", locale: "fr" },
    ]);
    await owner.retire({ discardPersistence: false });
    expect({
      active: owner.isActive(),
      queries: queryClient.getQueryCache().getAll(),
      snapshots: storage.values.size,
    }).toStrictEqual({ active: false, queries: [], snapshots: 1 });
    const resumed = await makeCache(storage);
    const { queryClient: browser } = resumed;
    expect(resumed.restoreDirectory()).toBe(true);
    expect({
      data: browser.getQueryData(key),
      updatedAt: browser.getQueryState(key)?.dataUpdatedAt,
    }).toStrictEqual({
      data: [{ id: 2, revision: "user-2", name: "Grace", locale: "fr" }],
      updatedAt: 0,
    });
    await resumed.retire();
    expect({
      snapshots: storage.values.size,
      restored: resumed.restoreDirectory(),
    }).toStrictEqual({ snapshots: 0, restored: false });
  });

  it("restores only validated directory DTOs for the same owner and compatible busters", async () => {
    const storage = makeStorage();
    const original = await makeCache(storage);
    const { queryClient: server } = original;
    const key = [...ownerKeyPrefix(identity), "rpc", "users", "list", "query"];
    server.setQueryData(key, [
      { id: 1, revision: "user-1", name: "Ada", locale: "en" },
    ]);
    original.persistDirectory();
    const [saved] = [...storage.values.entries()];
    expect(saved).toBeDefined();
    if (saved === undefined) {
      throw new Error("Expected a persisted directory");
    }
    const [storageKey, json] = saved;
    const restored = await makeCache(storage);
    const { queryClient: browser } = restored;
    expect(restored.restoreDirectory()).toBe(true);
    expect(browser.getQueryData(key)).toStrictEqual([
      { id: 1, revision: "user-1", name: "Ada", locale: "en" },
    ]);
    browser.clear();
    const snapshot = {
      identity,
      schemaVersion: 2,
      keyVersion: 1,
      directories: [
        {
          adapter: "rpc",
          data: [{ id: 1, revision: "user-1", name: "Ada", locale: "en" }],
        },
      ],
    };
    for (const incompatible of [
      { ...snapshot, identity: { ...identity, tenantId: "team-b" } },
      { ...snapshot, identity: { ...identity, permissionGeneration: 8 } },
      { ...snapshot, identity: { ...identity, sessionGeneration: 4 } },
      { ...snapshot, schemaVersion: 1 },
      { ...snapshot, keyVersion: 2 },
      {
        ...snapshot,
        directories: [
          {
            adapter: "rpc",
            data: [{ id: "invalid", name: "Ada", locale: "en" }],
          },
        ],
      },
    ]) {
      storage.setItem(storageKey, JSON.stringify(incompatible));
      expect(restored.restoreDirectory()).toBe(false);
      expect(browser.getQueryCache().getAll()).toHaveLength(0);
      expect(storage.getItem(storageKey)).toBeNull();
    }
    storage.setItem(storageKey, json);
    const other = await makeCache(storage, {
      ...identity,
      tenantId: "team-b",
    });
    expect(other.restoreDirectory()).toBe(false);
    expect(storage.getItem(storageKey)).toBe(json);
    await Promise.all([original.retire(), restored.retire(), other.retire()]);
  });
});
