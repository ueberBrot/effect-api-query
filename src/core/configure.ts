import { skipToken } from "@tanstack/query-core";
import type {
  MutationFunctionContext,
  QueryFunction,
  QueryFunctionContext,
  SkipToken,
} from "@tanstack/query-core";
import { Array as EffectArray, Predicate } from "effect";

import {
  preserveMetadataPolicy,
  resolveMetadataPolicy,
} from "./metadata-query";

/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns */
export type RuntimeOptions = Record<string, unknown>;
export type RuntimeQueryFunction = QueryFunction;
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
type RuntimeCallback = (...args: unknown[]) => unknown;
/* oxlint-enable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns */

const isCallback = (value: unknown): value is RuntimeCallback =>
  Predicate.isFunction(value);

const queryBuilders = new WeakMap<object, RuntimeQueryBuilder>();
const mutationBuilders = new WeakMap<object, RuntimeMutationBuilder>();

export const registerQueryBuilder = <Builder extends RuntimeQueryBuilder>(
  builder: Builder
): Builder => {
  queryBuilders.set(builder, builder);
  return builder;
};

export const registerMutationBuilder = <Builder extends RuntimeMutationBuilder>(
  builder: Builder
): Builder => {
  mutationBuilders.set(builder, builder);
  return builder;
};

export const readQueryBuilder = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  candidate: unknown
): RuntimeQueryBuilder | undefined =>
  Predicate.isFunction(candidate) ? queryBuilders.get(candidate) : undefined;

export const readMutationBuilder = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  candidate: unknown
): RuntimeMutationBuilder | undefined =>
  Predicate.isFunction(candidate) ? mutationBuilders.get(candidate) : undefined;

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
    if (!isCallback(candidate)) {
      throw new TypeError("Query interceptors must be functions");
    }
    const previous = build;
    build = (options) => {
      const built = previous(options);
      const { queryFn } = built;
      if (queryFn === skipToken) {
        return built;
      }
      const resolvePolicy =
        view === "metadata" ? resolveMetadataPolicy(options) : undefined;
      return {
        ...built,
        queryFn: async (context: QueryFunctionContext) => {
          const policy = resolvePolicy?.(context);
          let original: unknown;
          const result = await candidate({
            context,
            next: once(async () => {
              const data = await queryFn(context);
              original = data;
              return data;
            }),
          });
          return resolvePolicy === undefined
            ? result
            : preserveMetadataPolicy(original, result, policy);
        },
      };
    };
  }
  const { policy } = configuration;
  if (policy !== undefined && Object.keys(policy).length > 0) {
    const previous = build;
    build = (options) => previous({ ...policy, ...options });
  }
  return registerQueryBuilder(build);
};

export const configureMutation = (
  builder: RuntimeMutationBuilder,
  configuration: RuntimeViewConfiguration
): RuntimeMutationBuilder => {
  let build = builder;
  for (const candidate of EffectArray.reverse(
    configuration.interceptors ?? []
  )) {
    if (!isCallback(candidate)) {
      throw new TypeError("Mutation interceptors must be functions");
    }
    const previous = build;
    build = (options) => {
      const built = previous(options);
      return {
        ...built,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters
        mutationFn: async (input: unknown, context?: MutationFunctionContext) =>
          await candidate({
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
  return registerMutationBuilder(build);
};
