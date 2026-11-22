import type { QueryFilters, QueryKey } from "@tanstack/query-core";
import { Predicate } from "effect";

import type { QueryView } from "./inference";
import type { QueryFilterOptions } from "./query-filter";
import { indexQueryPrefixes } from "./query-prefix-index";

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
  const entries: (readonly [QueryKey, true])[] = [];
  const seen = new WeakSet();
  const visit = (node: BranchNode) => {
    if (seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Predicate.hasProperty(node, `${view}Options`)) {
      entries.push([[...node.key(), view], true]);
    }
    for (const child of Object.values(node)) {
      if (isBranchNode(child)) {
        visit(child);
      }
    }
  };
  visit(branch);
  const match = indexQueryPrefixes(entries);
  const queryKey = branch.key();
  return (options = {}) => ({
    ...options,
    queryKey,
    predicate: (query) =>
      match(query.queryKey) === true && (options.predicate?.(query) ?? true),
  });
};
