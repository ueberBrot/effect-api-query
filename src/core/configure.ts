import { skipToken } from "@tanstack/query-core";
import type {
  MutationFunctionContext,
  QueryFunctionContext,
  SkipToken,
} from "@tanstack/query-core";
import { Array as EffectArray, Predicate } from "effect";

import { preserveMetadataPolicy } from "./metadata-query";

/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns */
export type RuntimeOptions = Record<string, unknown>;
export type RuntimeQueryFunction = (
  context: QueryFunctionContext
) => Promise<unknown>;
export type RuntimeMutationFunction = (
  input: unknown,
  context?: MutationFunctionContext
) => Promise<unknown>;
export type RuntimeQueryBuilder = (
  options?: RuntimeOptions
) => RuntimeOptions & { readonly queryFn: RuntimeQueryFunction | SkipToken };
export type RuntimeMutationBuilder = (
  options?: RuntimeOptions
) => RuntimeOptions & { readonly mutationFn: RuntimeMutationFunction };
type QueryInterceptor = (execution: {
  readonly context: QueryFunctionContext;
  readonly next: () => Promise<unknown>;
}) => Promise<unknown>;
type MutationInterceptor = (execution: {
  readonly input: unknown;
  readonly context: MutationFunctionContext | undefined;
  readonly next: () => Promise<unknown>;
}) => Promise<unknown>;
type RuntimeCallback = (...args: unknown[]) => unknown;
/* oxlint-enable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns */

const isCallback = (value: unknown): value is RuntimeCallback =>
  Predicate.isFunction(value);

export interface RuntimeViewConfiguration {
  readonly policy?: RuntimeOptions | undefined;
  readonly interceptors?: readonly unknown[] | undefined;
  readonly callbacks?: "replace" | "compose" | undefined;
}

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

export const configureQuery = (
  builder: RuntimeQueryBuilder,
  view: string,
  configuration: RuntimeViewConfiguration
): RuntimeQueryBuilder => {
  let build = builder;
  for (const candidate of EffectArray.reverse(
    configuration.interceptors ?? []
  )) {
    if (!Predicate.isFunction(candidate)) {
      throw new TypeError("Query interceptors must be functions");
    }
    // SAFETY: Generated leaf types guarantee the interceptor's erased runtime signature.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const interceptor = candidate as QueryInterceptor;
    const previous = build;
    build = (options) => {
      const built = previous(options);
      const { queryFn } = built;
      if (queryFn === skipToken) {
        return built;
      }
      return {
        ...built,
        queryFn: async (context: QueryFunctionContext) => {
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
  }
  const { policy } = configuration;
  if (policy !== undefined && Object.keys(policy).length > 0) {
    const previous = build;
    build = (options) => previous({ ...policy, ...options });
  }
  return build;
};

export const configureMutation = (
  builder: RuntimeMutationBuilder,
  configuration: RuntimeViewConfiguration
): RuntimeMutationBuilder => {
  let build = builder;
  for (const candidate of EffectArray.reverse(
    configuration.interceptors ?? []
  )) {
    if (!Predicate.isFunction(candidate)) {
      throw new TypeError("Mutation interceptors must be functions");
    }
    // SAFETY: Generated leaf types guarantee the interceptor's erased runtime signature.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const interceptor = candidate as MutationInterceptor;
    const previous = build;
    build = (options) => {
      const built = previous(options);
      return {
        ...built,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters
        mutationFn: async (input: unknown, context?: MutationFunctionContext) =>
          await interceptor({
            input,
            context,
            next: once(async () => await built.mutationFn(input, context)),
          }),
      };
    };
  }
  const { policy } = configuration;
  if (policy !== undefined && Object.keys(policy).length > 0) {
    const previous = build;
    build =
      configuration.callbacks === "compose"
        ? (options = {}) => {
            const merged = { ...policy, ...options };
            for (const name of ["onSuccess", "onError", "onSettled"] as const) {
              const before = policy[name];
              const after = options[name];
              if (Object.hasOwn(options, name) && after === undefined) {
                continue;
              }
              if (isCallback(before)) {
                merged[name] = async (...args: unknown[]) => {
                  await before(...args);
                  if (isCallback(after)) {
                    await after(...args);
                  }
                };
              }
            }
            return previous(merged);
          }
        : (options) => previous({ ...policy, ...options });
  }
  return build;
};
