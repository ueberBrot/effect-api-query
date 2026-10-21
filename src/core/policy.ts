import type {
  MutationObserverOptions,
  QueryKey,
  QueryObserverOptions,
} from "@tanstack/query-core";
import { Predicate } from "effect";

import type {
  InferInput,
  InferMutationData,
  InferMutationError,
  InferQueryData,
  InferQueryError,
  MutationLeaf,
  QueryPageData,
  QueryPageParam,
  QueryViewKey,
  SupportedQueryView,
  ViewBuilder,
} from "./inference";
import type {
  ExactBuilderOptions,
  OwnedMutationOption,
  OwnedQueryOption,
} from "./types";

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

// oxlint-disable-next-line anti-slop/no-unknown-returns
type RuntimeCallback = (...args: unknown[]) => unknown;
const isCallback = (value: unknown): value is RuntimeCallback =>
  Predicate.isFunction(value);

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const bindPolicy = <Builder, Policy extends object>(
  builder: Builder,
  policy: Policy
): Builder => {
  // oxlint-disable-next-line anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const build = builder as (options: Policy) => unknown;
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  return ((options?: Policy) => build({ ...policy, ...options })) as Builder;
};

/** Binds typed defaults to a query builder. Call-site options replace matching defaults. */
export const withQueryPolicy = <
  Leaf,
  View extends SupportedQueryView<Leaf>,
  Supplied extends object,
>(
  leaf: Leaf,
  view: View,
  policy: ExactBuilderOptions<
    QueryPolicy<NoInfer<Leaf>, NoInfer<View>>,
    Supplied
  >
): ViewBuilder<Leaf, View> => {
  const builder =
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
    leaf[`${view}Options` as Extract<`${View}Options`, keyof Leaf>];
  return bindPolicy(builder, policy);
};

/** Binds typed defaults to a mutation builder. Call-site callbacks replace defaults. */
export const withMutationPolicy = <
  Leaf extends MutationLeaf,
  Supplied extends object,
>(
  leaf: Leaf,
  policy: ExactBuilderOptions<MutationPolicy<NoInfer<Leaf>>, Supplied>,
  { callbacks = "replace" }: MutationPolicyOptions = {}
): Leaf["mutationOptions"] => {
  if (callbacks === "replace") {
    return bindPolicy(leaf.mutationOptions, policy);
  }
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const build = leaf.mutationOptions as (
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
    options: Record<string, unknown>
    // oxlint-disable-next-line anti-slop/no-unknown-returns
  ) => unknown;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  const shared: Record<string, unknown> = policy;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  return (options: Record<string, unknown> = {}) => {
    const merged = { ...shared, ...options };
    for (const name of ["onSuccess", "onError", "onSettled"] as const) {
      const before = shared[name];
      const after = options[name];
      if (isCallback(before)) {
        merged[name] = async (...args: unknown[]) => {
          await before(...args);
          if (isCallback(after)) {
            await after(...args);
          }
        };
      }
    }
    return build(merged);
  };
};
