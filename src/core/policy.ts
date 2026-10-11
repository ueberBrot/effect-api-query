import type {
  InfiniteData,
  MutationObserverOptions,
  QueryKey,
  QueryObserverOptions,
} from '@tanstack/query-core'

import type {
  InferInput,
  InferMutationData,
  InferMutationError,
  InferQueryData,
  InferQueryError,
  QueryView,
  QueryViewKey,
  SupportedQueryView,
} from './inference'
import type { ExactBuilderOptions, OwnedMutationOption, OwnedQueryOption } from './types'

export type LocalQueryOption =
  | OwnedQueryOption
  | 'select'
  | 'initialData'
  | 'initialDataUpdatedAt'
  | 'placeholderData'
  | 'initialPageParam'
  | 'getNextPageParam'
  | 'getPreviousPageParam'
  | 'maxPages'

export type QueryPageData<Data, View extends QueryView> = View extends 'infinite'
  ? Data extends InfiniteData<infer Page>
    ? Page
    : never
  : Data

export type QueryPageParam<Data, View extends QueryView> = View extends 'infinite'
  ? Data extends InfiniteData<unknown, infer PageParam>
    ? PageParam
    : never
  : never

export type NativeQueryPolicy<Leaf, View extends SupportedQueryView<Leaf>> = QueryObserverOptions<
  QueryPageData<InferQueryData<Leaf, View>, View>,
  InferQueryError<Leaf, View>,
  InferQueryData<Leaf, View>,
  InferQueryData<Leaf, View>,
  Extract<QueryViewKey<Leaf, View>, QueryKey>,
  QueryPageParam<InferQueryData<Leaf, View>, View>
>

/** Reusable cache and observer policies; inputs, projections and identity remain local. */
export type QueryPolicy<
  Leaf,
  View extends SupportedQueryView<Leaf> = Extract<'query', SupportedQueryView<Leaf>>,
> = Omit<NativeQueryPolicy<Leaf, View>, LocalQueryOption>

/** Reusable mutation callbacks receive typed data and variables and an unknown local context. */
export type MutationPolicy<Leaf> = Omit<
  MutationObserverOptions<InferMutationData<Leaf>, InferMutationError<Leaf>, InferInput<Leaf>>,
  OwnedMutationOption | 'onMutate'
>

export type ViewBuilder<Leaf, View extends QueryView> = Leaf[Extract<`${View}Options`, keyof Leaf>]
export interface MutationLeaf {
  readonly mutationOptions: (...args: never[]) => unknown
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const bindPolicy = <Builder, Policy extends object>(builder: Builder, policy: Policy): Builder => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const build = builder as (options: Policy) => unknown
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return ((options?: Policy) => build({ ...policy, ...options })) as Builder
}

/** Binds typed defaults to a query builder. Call-site options replace matching defaults. */
export const withQueryPolicy = <
  Leaf,
  View extends SupportedQueryView<Leaf>,
  Supplied extends object,
>(
  leaf: Leaf,
  view: View,
  policy: ExactBuilderOptions<QueryPolicy<NoInfer<Leaf>, NoInfer<View>>, Supplied>,
): ViewBuilder<Leaf, View> => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const builder = leaf[`${view}Options` as Extract<`${View}Options`, keyof Leaf>]
  return bindPolicy(builder, policy)
}

/** Binds typed defaults to a mutation builder. Call-site callbacks replace defaults. */
export const withMutationPolicy = <Leaf extends MutationLeaf, Supplied extends object>(
  leaf: Leaf,
  policy: ExactBuilderOptions<MutationPolicy<NoInfer<Leaf>>, Supplied>,
): Leaf['mutationOptions'] => bindPolicy(leaf.mutationOptions, policy)
