import { replaceEqualDeep } from "@tanstack/query-core";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { Predicate } from "effect";

import type { UnaryOperation } from "./operation";
import { executeBuffered } from "./runtime";
import type { RunPromiseExit } from "./types";

const isEnumerableDataProperty = (descriptor?: PropertyDescriptor) =>
  descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");

const hasPlainSnapshotProperties = (value: Readonly<Record<string, unknown>>) =>
  Object.values(Object.getOwnPropertyDescriptors(value)).every(
    isEnumerableDataProperty
  );

export const freezeMetadata = <Data>(data: Data): Data => {
  if (!Predicate.isObject(data)) {
    return data;
  }
  const { headers } = data;
  const snapshot =
    Predicate.isObject(headers) &&
    (!Object.isFrozen(headers) ||
      Object.getPrototypeOf(headers) !== Object.prototype ||
      !hasPlainSnapshotProperties(headers))
      ? Object.freeze({ ...headers })
      : headers;
  return Object.isFrozen(data) &&
    snapshot === headers &&
    hasPlainSnapshotProperties(data)
    ? data
    : Object.freeze({ ...data, headers: snapshot });
};

type StructuralSharing = (previous: unknown, data: unknown) => unknown;

const isStructuralSharing = (policy: unknown): policy is StructuralSharing =>
  Predicate.isFunction(policy);

const shareFetchedMetadata = (previous: unknown, data: unknown) => {
  if (!Predicate.isObject(previous) || !Predicate.isObject(data)) {
    return replaceEqualDeep(previous, data);
  }

  const { headers } = data;
  const previousEnvelope = hasPlainSnapshotProperties(previous)
    ? previous
    : Object.fromEntries(
        Object.keys(data)
          .filter((name) => Object.hasOwn(previous, name))
          .map((name) => [name, previous[name]])
      );
  const previousHeaderProperty = Object.getOwnPropertyDescriptor(
    previousEnvelope,
    "headers"
  );
  const previousHeaders: unknown = previousHeaderProperty?.value;
  const sameHeaders =
    isEnumerableDataProperty(previousHeaderProperty) &&
    Predicate.isObject(headers) &&
    Predicate.isObject(previousHeaders) &&
    Object.keys(headers).length ===
      Object.getOwnPropertyNames(previousHeaders).length &&
    Object.entries(headers).every(([name, value]) => {
      const property = Object.getOwnPropertyDescriptor(previousHeaders, name);
      return isEnumerableDataProperty(property) && property?.value === value;
    });
  const shared = replaceEqualDeep(previousEnvelope, {
    ...data,
    headers: previousHeaders,
  });
  return sameHeaders ? shared : { ...shared, headers };
};

const shareQueryData = (
  previous: unknown,
  data: unknown,
  policy: unknown,
  fetched: boolean
) => {
  if (policy === false) {
    return data;
  }
  if (isStructuralSharing(policy)) {
    return policy(previous, data);
  }
  return fetched
    ? shareFetchedMetadata(previous, data)
    : replaceEqualDeep(previous, data);
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
  for (const name of ["data", "status", "headers"] as const) {
    if (!Object.hasOwn(replacement, name) && name in data) {
      Object.defineProperty(replacement, name, {
        enumerable: true,
        value: data[name],
      });
    }
  }
  const snapshot = freezeMetadata(replacement);
  fetchedPolicies.set(snapshot, produced ?? { policy: fallback });
  return snapshot;
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
        produced === undefined ? localPolicy : produced.policy,
        produced !== undefined
      );
      return produced === undefined ? shared : freezeMetadata(shared);
    };
  }

  return (input: unknown) => async (context: QueryFunctionContext) => {
    const policy = resolvePolicy(context);
    const data = await executeBuffered(
      description,
      "metadata",
      input,
      runPromiseExit,
      requestOptions,
      context.signal
    );
    if (Predicate.isObject(data)) {
      fetchedPolicies.set(data, { policy });
    }
    return data;
  };
};
