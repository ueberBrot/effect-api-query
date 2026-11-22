import { replaceEqualDeep } from "@tanstack/query-core";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { Exit, Predicate } from "effect";

import type { UnaryOperation } from "./operation";
import type { RunPromiseExit } from "./types";

type StructuralSharing = (previous: unknown, data: unknown) => unknown;

const isStructuralSharing = (policy: unknown): policy is StructuralSharing =>
  Predicate.isFunction(policy);

const shareQueryData = (previous: unknown, data: unknown, policy: unknown) => {
  if (policy === false) {
    return data;
  }
  if (isStructuralSharing(policy)) {
    return policy(previous, data);
  }
  return replaceEqualDeep(previous, data);
};

const fetchedPolicies = new WeakMap<object, { readonly policy: unknown }>();

export const resolveMetadataPolicy = (options?: Record<string, unknown>) => {
  const hasLocalPolicy =
    options !== undefined && Object.hasOwn(options, "structuralSharing");
  const localPolicy = options?.["structuralSharing"];
  return ({ client, queryKey }: QueryFunctionContext) =>
    hasLocalPolicy
      ? localPolicy
      : client.defaultQueryOptions({ queryKey }).structuralSharing;
};

export const preserveMetadataPolicy = <Data>(
  previous: unknown,
  data: Data,
  fallback: unknown
): Data => {
  if (!Predicate.isObject(data)) {
    return data;
  }
  const produced = Predicate.isObject(previous)
    ? fetchedPolicies.get(previous)
    : undefined;
  if (previous === data && produced !== undefined) {
    return data;
  }
  const replacement = { ...data };
  fetchedPolicies.set(replacement, produced ?? { policy: fallback });
  return replacement;
};

export const prepareMetadataExecution = (
  description: NonNullable<UnaryOperation["metadata"]>,

  options: Record<string, unknown>,
  runPromiseExit: RunPromiseExit<unknown>,

  requestOptions: unknown,
  skipped: boolean
) => {
  const resolvePolicy = resolveMetadataPolicy(options);
  const localPolicy = options["structuralSharing"];
  if (!skipped) {
    options["structuralSharing"] = (previous: unknown, data: unknown) => {
      const produced = Predicate.isObject(data)
        ? fetchedPolicies.get(data)
        : undefined;
      if (Predicate.isObject(data)) {
        fetchedPolicies.delete(data);
      }
      const shared = shareQueryData(
        previous,
        data,
        produced === undefined ? localPolicy : produced.policy
      );
      return produced === undefined ? shared : description.finalizeData(shared);
    };
  }

  return (input: unknown) => async (context: QueryFunctionContext) => {
    const policy = resolvePolicy(context);
    const exit = await runPromiseExit(
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
      description.invoke(input, requestOptions),
      { signal: context.signal }
    );
    if (Exit.isFailure(exit)) {
      throw description.executionError("metadata", exit.cause);
    }
    const data = exit.value === undefined ? null : exit.value;
    if (Predicate.isObject(data)) {
      fetchedPolicies.set(data, { policy });
    }
    return data;
  };
};
