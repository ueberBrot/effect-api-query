import { hashKey } from "@tanstack/query-core";
import type { QueryFilters, QueryKey } from "@tanstack/query-core";
import { Predicate } from "effect";

import type { QueryView } from "./inference";
import type { QueryFilterOptions } from "./query-filter";

interface BranchNode {
  readonly key: () => QueryKey;
}
// Generated branches and leaves expose a key function; other child properties are builders.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
const isBranchNode = (node: unknown): node is BranchNode =>
  Predicate.hasProperty(node, "key") && Predicate.isFunction(node.key);

/** Selects one view across a generated root, branch or leaf without changing cache keys. */
export const createBranchQueryFilter = (
  branch: { readonly key: () => QueryKey },
  view: QueryView
): ((
  options?: QueryFilterOptions
) => QueryFilters & { readonly queryKey: QueryKey }) => {
  const byLength = new Map<number, Set<string>>();
  const seen = new WeakSet();
  const visit = (node: BranchNode) => {
    if (seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Predicate.hasProperty(node, `${view}Options`)) {
      const prefix: QueryKey = [...node.key(), view];
      const entries = byLength.get(prefix.length) ?? new Set<string>();
      entries.add(hashKey(prefix));
      byLength.set(prefix.length, entries);
    }
    for (const child of Object.values(node)) {
      if (isBranchNode(child)) {
        visit(child);
      }
    }
  };
  visit(branch);
  const queryKey = branch.key();
  return (options = {}) => ({
    ...options,
    queryKey,
    predicate: (query) => {
      for (const [length, prefixes] of byLength) {
        if (
          query.queryKey.length >= length &&
          prefixes.has(hashKey(query.queryKey.slice(0, length)))
        ) {
          return options.predicate?.(query) ?? true;
        }
      }
      return false;
    },
  });
};
