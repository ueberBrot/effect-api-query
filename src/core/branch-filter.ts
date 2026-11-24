import type { QueryKey } from "@tanstack/query-core";

import type { QueryView } from "./inference";
import type {
  BranchQueryFilter,
  BranchQueryFilterOptions,
} from "./query-filter";
import { indexQueryPrefixes } from "./query-prefix-index";
import { generatedViewKeyLimit } from "./utility-key";

export interface FilterPath {
  readonly key: QueryKey;
  readonly views: readonly QueryView[];
}

export const createBranchFilter = (
  queryKey: QueryKey,
  paths: readonly FilterPath[]
): BranchQueryFilter => {
  let matchers: Map<QueryView, (key: QueryKey) => true | undefined> | undefined;
  return ({ view, ...options }: BranchQueryFilterOptions = {}) => {
    if (view === undefined) {
      return { ...options, queryKey };
    }
    matchers ??= new Map();
    let match = matchers.get(view);
    if (match === undefined) {
      const entries: (readonly [QueryKey, true, number])[] = [];
      for (const path of paths) {
        if (path.views.includes(view)) {
          const prefix = [...path.key, view];
          entries.push([prefix, true, generatedViewKeyLimit(prefix)]);
        }
      }
      match = indexQueryPrefixes(entries, { order: "discovery" });
      matchers.set(view, match);
    }
    const matchesView = match;
    return {
      ...options,
      queryKey,
      predicate: (query) =>
        matchesView(query.queryKey) === true &&
        (options.predicate?.(query) ?? true),
    };
  };
};
