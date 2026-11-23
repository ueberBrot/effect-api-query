import { canonicalizeArray } from "./canonical-key";
import type { TreeErrors } from "./operation";
import type { JsonValue } from "./types";

export interface KeyPrefixInput {
  readonly keyPrefix?: unknown;
}

export const normalizeUtilityKeyPrefix = (
  options: KeyPrefixInput | undefined,
  invalid: TreeErrors["invalidPrefix"]
): readonly JsonValue[] => {
  if (options === undefined || !("keyPrefix" in options)) {
    return [];
  }
  const { keyPrefix } = options;
  if (!Array.isArray(keyPrefix) || keyPrefix.length === 0) {
    throw invalid("Shape");
  }
  try {
    return canonicalizeArray(keyPrefix);
  } catch (error) {
    throw invalid("Value", error);
  }
};

const reservedSegments = new Set([
  "__proto__",
  "call",
  "constructor",
  "effect",
  "infiniteKey",
  "infiniteOptions",
  "key",
  "liveKey",
  "liveOptions",
  "metadataKey",
  "metadataOptions",
  "mutationKey",
  "mutationOptions",
  "prototype",
  "queryFilter",
  "queryKey",
  "queryOptions",
  "streamedKey",
  "streamedOptions",
]);

export type InvalidUtilityPath =
  | "invalid"
  | "duplicate"
  | "parent"
  | "descendant";

export const validateUtilityPaths = <
  Operation extends { readonly path: readonly string[] },
>(
  operations: readonly Operation[],
  error: (
    operation: Operation,
    kind: InvalidUtilityPath,
    conflictingPath: readonly string[]
  ) => Error
): void => {
  const paths = new Map<string, readonly string[] | null>();
  for (const operation of operations) {
    const { path } = operation;
    if (
      path.length === 0 ||
      path.some((segment) => !segment || reservedSegments.has(segment))
    ) {
      throw error(operation, "invalid", path);
    }
    const key = JSON.stringify(path);
    const match = paths.get(key);
    if (match !== undefined) {
      throw error(
        operation,
        match === null ? "duplicate" : "descendant",
        match ?? path
      );
    }
    for (let index = 1; index < path.length; index += 1) {
      const parent = path.slice(0, index);
      const parentKey = JSON.stringify(parent);
      const parentMatch = paths.get(parentKey);
      if (parentMatch === null) {
        throw error(operation, "parent", parent);
      }
      if (parentMatch === undefined) {
        paths.set(parentKey, path);
      }
    }
    paths.set(key, null);
  }
};
