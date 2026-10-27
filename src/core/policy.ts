import type {
  MutationObserverOptions,
  QueryKey,
  QueryObserverOptions,
} from "@tanstack/query-core";

import type {
  InferInput,
  InferMutationData,
  InferMutationError,
  InferQueryData,
  InferQueryError,
  QueryPageData,
  QueryPageParam,
  QueryViewKey,
  SupportedQueryView,
} from "./inference";
import type { OwnedMutationOption, OwnedQueryOption } from "./types";

export type LocalQueryOption =
  | OwnedQueryOption
  | "select"
  | "initialData"
  | "initialDataUpdatedAt"
  | "placeholderData"
  | "initialPageParam"
  | "getNextPageParam"
  | "getPreviousPageParam"
  | "maxPages";

export type NativeQueryPolicy<
  Leaf,
  View extends SupportedQueryView<Leaf>,
> = QueryObserverOptions<
  QueryPageData<InferQueryData<Leaf, View>, View>,
  InferQueryError<Leaf, View>,
  InferQueryData<Leaf, View>,
  InferQueryData<Leaf, View>,
  Extract<QueryViewKey<Leaf, View>, QueryKey>,
  QueryPageParam<InferQueryData<Leaf, View>, View>
>;

/** Reusable cache and observer policies; inputs, projections and identity remain local. */
export type QueryPolicy<
  Leaf,
  View extends SupportedQueryView<Leaf> = Extract<
    "query",
    SupportedQueryView<Leaf>
  >,
> = Omit<NativeQueryPolicy<Leaf, View>, LocalQueryOption>;

/** Reusable mutation callbacks receive typed data and variables and an unknown local context. */
export type MutationPolicy<Leaf> = Omit<
  MutationObserverOptions<
    InferMutationData<Leaf>,
    InferMutationError<Leaf>,
    InferInput<Leaf>
  >,
  OwnedMutationOption | "onMutate"
>;

export interface MutationPolicyOptions {
  /** Compose shared callbacks before local callbacks instead of replacing them. */
  readonly callbacks?: "replace" | "compose";
}
