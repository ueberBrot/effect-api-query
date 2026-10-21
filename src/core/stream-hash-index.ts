import { hashKey } from "@tanstack/query-core";
import type {
  Query,
  QueryCache,
  QueryFunctionContext,
  QueryKey,
} from "@tanstack/query-core";

type HashFunction = ((key: QueryKey) => string) | undefined;

interface IndexedQuery {
  readonly query: Query;
  readonly order: number;
  readonly hash: HashFunction;
}

interface HashIndex {
  readonly queries: Map<string, IndexedQuery>;
  readonly groups: Map<HashFunction, Map<string, IndexedQuery>>;
}

const indexes = new WeakMap<QueryCache, HashIndex>();

const cacheIndex = (cache: QueryCache): HashIndex => {
  const existing = indexes.get(cache);
  if (existing !== undefined) {
    return existing;
  }
  const index: HashIndex = { queries: new Map(), groups: new Map() };
  let nextOrder = 0;
  const remove = (queryHash: string) => {
    const previous = index.queries.get(queryHash);
    if (previous === undefined) {
      return;
    }
    const group = index.groups.get(previous.hash);
    group?.delete(queryHash);
    if (group?.size === 0) {
      index.groups.delete(previous.hash);
    }
    index.queries.delete(queryHash);
  };
  const update = (query: Query) => {
    const previous = index.queries.get(query.queryHash);
    const hash = query.options.queryKeyHashFn;
    if (previous?.query === query && previous.hash === hash) {
      return;
    }
    remove(query.queryHash);
    const entry = {
      query,
      hash,
      order: previous?.query === query ? previous.order : nextOrder,
    };
    if (previous?.query !== query) {
      nextOrder += 1;
    }
    index.queries.set(query.queryHash, entry);
    let group = index.groups.get(hash);
    if (group === undefined) {
      group = new Map();
      index.groups.set(hash, group);
    }
    group.set(query.queryHash, entry);
  };
  for (const query of cache.getAll()) {
    update(query);
  }
  const unsubscribe = cache.subscribe((event) => {
    const query = cache.get(event.query.queryHash);
    if (query === undefined) {
      remove(event.query.queryHash);
    } else {
      update(query);
    }
    if (index.queries.size === 0) {
      unsubscribe();
      indexes.delete(cache);
    }
  });
  indexes.set(cache, index);
  return index;
};

export const validateStreamHash = (
  { client, queryKey }: QueryFunctionContext,
  unsupportedHash: () => Error
) => {
  const { queryHash, queryKeyHashFn } = client.defaultQueryOptions({
    queryKey,
  });
  if (queryHash !== (queryKeyHashFn ?? hashKey)(queryKey)) {
    throw unsupportedHash();
  }
  const cache = client.getQueryCache();
  const index = cacheIndex(cache);
  const current = cache.get(queryHash);
  const currentOrder =
    current === undefined
      ? Infinity
      : (index.queries.get(current.queryHash)?.order ?? Infinity);
  let canonical: string | undefined;
  for (const [hash, queries] of index.groups) {
    if (hash === queryKeyHashFn) {
      continue;
    }
    let candidate: IndexedQuery | undefined;
    try {
      candidate = queries.get((hash ?? hashKey)(queryKey));
    } catch (error) {
      for (const entry of queries.values()) {
        if (entry.order < currentOrder) {
          throw error;
        }
      }
      continue;
    }
    if (candidate === undefined || candidate.query === current) {
      continue;
    }
    if (candidate.order < currentOrder) {
      throw unsupportedHash();
    }
    try {
      canonical ??= hashKey(queryKey);
      if (hashKey(candidate.query.queryKey) !== canonical) {
        continue;
      }
    } catch {
      continue;
    }
    throw unsupportedHash();
  }
  return current;
};
