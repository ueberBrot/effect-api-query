import type { QueryFilters, QueryKey } from "@tanstack/query-core";

import { canonicalize } from "./canonical-key";
import type { InferInput, SupportedQueryView } from "./inference";
import type { JsonValue } from "./types";
import { viewPrefix } from "./view-prefix";

/** Native query filters with identity supplied by the generated leaf and view. */
export type QueryFilterOptions = Omit<QueryFilters, "queryKey"> & {
  readonly queryKey?: never;
};

/** A typed application projection into a partial canonical key payload. */
export type QueryFilterEncoder<Input> = (input: Input) => JsonValue;

/** Builds native filters for every input of one supported query view. */
export function createQueryFilter<
  Leaf extends { readonly key: () => QueryKey },
>(
  leaf: Leaf,
  view: SupportedQueryView<NoInfer<Leaf>>
): (
  options?: QueryFilterOptions
) => QueryFilters & { readonly queryKey: QueryKey };
/** Builds partial-input filters without running full payload constructors or defaults. */
export function createQueryFilter<
  Leaf extends { readonly key: () => QueryKey },
  Input = InferInput<Leaf>,
>(
  leaf: Leaf,
  view: SupportedQueryView<NoInfer<Leaf>>,
  encode: QueryFilterEncoder<Input>
): (
  input: Input,
  options?: QueryFilterOptions
) => QueryFilters & { readonly queryKey: QueryKey };
export function createQueryFilter<
  Leaf extends { readonly key: () => QueryKey },
  Input = InferInput<Leaf>,
>(
  leaf: Leaf,
  view: SupportedQueryView<Leaf>,
  encode?: QueryFilterEncoder<Input>
) {
  const prefix = viewPrefix(leaf, view);
  if (encode === undefined) {
    return (
      options?: QueryFilterOptions
    ): QueryFilters & { readonly queryKey: QueryKey } => ({
      ...options,
      queryKey: prefix,
    });
  }
  return (
    input: Input,
    options?: QueryFilterOptions
  ): QueryFilters & { readonly queryKey: QueryKey } => ({
    ...options,
    queryKey: Object.freeze([...prefix, canonicalize(encode(input))]),
  });
}
