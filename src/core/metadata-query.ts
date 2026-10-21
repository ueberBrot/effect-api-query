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

export const preserveMetadataPolicy = <Data>(
  previous: unknown,
  data: Data
): Data => {
  if (Predicate.isObject(previous) && Predicate.isObject(data)) {
    const policy = fetchedPolicies.get(previous);
    if (policy !== undefined) {
      fetchedPolicies.set(data, policy);
    }
  }
  return data;
};

export const prepareMetadataExecution = (
  description: NonNullable<UnaryOperation["metadata"]>,

  options: Record<string, unknown>,
  runPromiseExit: RunPromiseExit<unknown>,

  requestOptions: unknown,
  skipped: boolean
) => {
  const hasLocalPolicy = Object.hasOwn(options, "structuralSharing");
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

  return (input: unknown) =>
    async ({ client, queryKey, signal }: QueryFunctionContext) => {
      const policy = hasLocalPolicy
        ? localPolicy
        : client.defaultQueryOptions({ queryKey }).structuralSharing;
      const exit = await runPromiseExit(
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
        description.invoke(input, requestOptions),
        { signal }
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
