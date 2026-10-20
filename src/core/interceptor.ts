import { skipToken } from "@tanstack/query-core";
import type {
  MutationFunctionContext,
  QueryFunctionContext,
  QueryKey,
  SkipToken,
} from "@tanstack/query-core";

import type {
  InferInput,
  InferMutationData,
  InferQueryData,
  MutationLeaf,
  QueryPageData,
  QueryPageParam,
  QueryViewKey,
  SupportedQueryView,
  ViewBuilder,
} from "./inference";
import { preserveMetadataPolicy } from "./metadata-query";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
type RuntimeOptions = Record<string, unknown>;

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

const once = <Data>(next: () => Promise<Data>) => {
  let called = false;
  return async () => {
    if (called) {
      throw new Error(
        "An execution interceptor may call next only once per attempt"
      );
    }
    called = true;
    return await next();
  };
};

/** Preserves the builder's overloads and leaves skipToken queries disabled. */
export const withQueryInterceptor = <
  Leaf,
  View extends SupportedQueryView<Leaf>,
>(
  leaf: Leaf,
  view: View,
  interceptor: QueryInterceptor<NoInfer<Leaf>, NoInfer<View>>
): ViewBuilder<Leaf, View> => {
  type Execution = Parameters<typeof interceptor>[0];
  type Data = Awaited<ReturnType<typeof interceptor>>;
  // oxlint-disable typescript/no-unsafe-type-assertion
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
  const build = leaf[
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
    `${view}Options` as Extract<`${View}Options`, keyof Leaf>
  ] as (options?: RuntimeOptions) => {
    readonly queryFn:
      | ((context: Execution["context"]) => Promise<Data>)
      | SkipToken;
    readonly queryKey: QueryKey;
  };
  // oxlint-enable typescript/no-unsafe-type-assertion
  const wrapped = (options?: RuntimeOptions) => {
    const built = build(options);
    const { queryFn } = built;
    if (queryFn === skipToken) {
      return built;
    }
    return {
      ...built,
      queryFn: async (context: Execution["context"]) => {
        let original: unknown;
        const result = await interceptor({
          context,
          next: once(async () => {
            const data = await queryFn(context);
            original = data;
            return data;
          }),
        });
        return view === "metadata"
          ? preserveMetadataPolicy(original, result)
          : result;
      },
    };
  };
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  return wrapped as ViewBuilder<Leaf, View>;
};

/** Local lifecycle callbacks cannot bypass this mutation-function wrapper. */
export const withMutationInterceptor = <Leaf extends MutationLeaf>(
  leaf: Leaf,
  interceptor: MutationInterceptor<NoInfer<Leaf>>
): Leaf["mutationOptions"] => {
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const build = leaf.mutationOptions as (options?: RuntimeOptions) => {
    readonly mutationFn: (
      input: InferInput<Leaf>,
      context?: MutationFunctionContext
    ) => Promise<InferMutationData<Leaf>>;
  };
  return (options?: RuntimeOptions) => {
    const built = build(options);
    return {
      ...built,
      mutationFn: async (
        input: InferInput<Leaf>,
        context?: MutationFunctionContext
      ) =>
        await interceptor({
          input,
          context,
          next: once(async () => await built.mutationFn(input, context)),
        }),
    };
  };
};
