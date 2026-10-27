import type {
  MutationFunctionContext,
  QueryFunctionContext,
  QueryKey,
} from "@tanstack/query-core";

import type {
  InferInput,
  InferMutationData,
  InferQueryData,
  QueryPageData,
  QueryPageParam,
  QueryViewKey,
  SupportedQueryView,
} from "./inference";

/** Wraps one native query-function attempt, including each retry. */
export type QueryInterceptor<
  Leaf,
  View extends SupportedQueryView<Leaf>,
> = (execution: {
  readonly context: QueryFunctionContext<
    Extract<QueryViewKey<Leaf, View>, QueryKey>,
    QueryPageParam<InferQueryData<Leaf, View>, View>
  >;
  readonly next: () => Promise<QueryPageData<InferQueryData<Leaf, View>, View>>;
}) => Promise<QueryPageData<InferQueryData<Leaf, View>, View>>;

/** Wraps a native mutation-function attempt without replacing observer callbacks. */
export type MutationInterceptor<Leaf> = (execution: {
  readonly input: InferInput<Leaf>;
  readonly context: MutationFunctionContext | undefined;
  readonly next: () => Promise<InferMutationData<Leaf>>;
}) => Promise<InferMutationData<Leaf>>;
