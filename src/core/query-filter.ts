import type { InvalidateQueryFilters, QueryKey } from "@tanstack/query-core";

import { canonicalize } from "./canonical-key";
import type { InferInput, QueryView, SupportedQueryView } from "./inference";
import type { PreparedInput } from "./prepared-input";
import type { JsonValue } from "./types";
import { viewPrefix } from "./view-prefix";

/** Native query filters with identity supplied by the generated leaf and view. */
export type QueryFilterOptions = Omit<InvalidateQueryFilters, "queryKey"> & {
  readonly queryKey?: never;
};

export type QueryFilter = InvalidateQueryFilters & {
  readonly queryKey: QueryKey;
};

export type BranchQueryFilterOptions = QueryFilterOptions & {
  readonly view?: QueryView;
  readonly input?: never;
};

export type BranchQueryFilter = (
  options?: BranchQueryFilterOptions
) => QueryFilter;

export type StreamedFilterPolicy<Policy> =
  | Policy
  | { readonly [Key in keyof Policy]?: never };

export type LeafQueryFilter<
  Input,
  Inputless extends boolean,
  View extends QueryView,
  Policy extends Partial<Record<QueryView, object>> | undefined = undefined,
> = (
  options?:
    | (QueryFilterOptions & { readonly view?: never; readonly input?: never })
    | {
        [V in View]: QueryFilterOptions &
          (V extends keyof Policy ? Policy[V] : object) & {
            readonly view: V;
            readonly input?: Inputless extends true
              ? never
              : Input | PreparedInput<Input>;
          };
      }[View]
) => QueryFilter;

/** A typed application projection into a partial canonical key payload. */
export type QueryFilterEncoder<Input> = (input: Input) => JsonValue;

/** Builds partial-input filters without running full payload constructors or defaults. */
export const createQueryFilter = <
  Leaf extends { readonly key: () => QueryKey },
  Input = InferInput<Leaf>,
>(
  leaf: Leaf,
  view: SupportedQueryView<NoInfer<Leaf>>,
  encode: QueryFilterEncoder<Input>
): ((input: Input, options?: QueryFilterOptions) => QueryFilter) => {
  const prefix = viewPrefix(leaf, view);
  return (input, options) => ({
    ...options,
    queryKey: Object.freeze([...prefix, canonicalize(encode(input))]),
  });
};
