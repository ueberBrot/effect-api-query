import type {
  dataTagErrorSymbol,
  dataTagSymbol,
  InfiniteData,
  SkipToken,
} from "@tanstack/query-core";

import type { PreparedInput } from "./prepared-input";

export type QueryView = "query" | "infinite" | "metadata" | "live" | "streamed";

export type SupportedQueryView<Leaf> = {
  [View in QueryView]: [Leaf] extends [
    Record<`${View}Key`, (...args: never[]) => unknown>,
  ]
    ? [Leaf] extends [Record<`${View}Options`, (...args: never[]) => unknown>]
      ? View
      : never
    : never;
}[QueryView];

export type QueryViewKey<Leaf, View extends QueryView> =
  Leaf extends Record<`${View}Key`, (...args: never[]) => infer Key>
    ? Key
    : never;

export type ViewBuilder<Leaf, View extends QueryView> = Leaf[Extract<
  `${View}Options`,
  keyof Leaf
>];

export type QueryPageData<
  Data,
  View extends QueryView,
> = View extends "infinite"
  ? Data extends InfiniteData<infer Page>
    ? Page
    : never
  : Data;

export type QueryPageParam<
  Data,
  View extends QueryView,
> = View extends "infinite"
  ? Data extends InfiniteData<unknown, infer PageParam>
    ? PageParam
    : never
  : never;

export interface MutationLeaf {
  // oxlint-disable-next-line anti-slop/no-unknown-returns
  readonly mutationOptions: (...args: never[]) => unknown;
}

export type MutationResult<Leaf> = Leaf extends {
  readonly mutationOptions: (...args: never[]) => infer Options;
}
  ? Options
  : never;

export type OptionsInput<Leaf> = Leaf extends {
  readonly streamedOptions: (...args: infer Args) => unknown;
}
  ? NonNullable<Args[0]> extends { readonly input: infer Input }
    ? Exclude<Input, SkipToken | PreparedInput<unknown>>
    : void
  : Leaf extends { readonly queryKey: (...args: infer Args) => unknown }
    ? Args extends []
      ? void
      : Exclude<Args[0], PreparedInput<unknown>>
    : never;

/** The RPC payload constructor input or decoded HTTP request accepted by a leaf. */
export type InferInput<Leaf> = [MutationResult<Leaf>] extends [never]
  ? OptionsInput<Leaf>
  : MutationResult<Leaf> extends {
        readonly mutationFn: (input: infer Input) => unknown;
      }
    ? Input
    : never;

/** The cached data for a supported view, before an observer's select projection. */
export type InferQueryData<
  Leaf,
  View extends SupportedQueryView<Leaf> = Extract<
    "query",
    SupportedQueryView<Leaf>
  >,
> = [QueryViewKey<Leaf, View>] extends [never]
  ? never
  : QueryViewKey<Leaf, View> extends { readonly [dataTagSymbol]: infer Data }
    ? Data
    : never;

/** The execution and package errors carried by a supported view's concrete key. */
export type InferQueryError<
  Leaf,
  View extends SupportedQueryView<Leaf> = Extract<
    "query",
    SupportedQueryView<Leaf>
  >,
> = [QueryViewKey<Leaf, View>] extends [never]
  ? never
  : QueryViewKey<Leaf, View> extends {
        readonly [dataTagErrorSymbol]: infer Error;
      }
    ? Error
    : never;

/** The unmodified successful value returned by a buffered mutation. */
export type InferMutationData<Leaf> = [MutationResult<Leaf>] extends [never]
  ? never
  : MutationResult<Leaf> extends {
        readonly mutationFn: (...args: never[]) => Promise<infer Data>;
      }
    ? Data
    : never;

/** The execution error exposed by a buffered mutation. */
export type InferMutationError<Leaf> = [MutationResult<Leaf>] extends [never]
  ? never
  : MutationResult<Leaf> extends {
        readonly retry?:
          | boolean
          | number
          | ((count: number, error: infer Error) => boolean);
      }
    ? Error
    : never;
