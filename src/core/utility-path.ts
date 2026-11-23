import { Array as EffectArray } from "effect";

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
  | { readonly kind: "invalid" }
  | {
      readonly kind: "duplicate" | "parent" | "descendant";
      readonly segments: readonly string[];
    };

export interface UtilityPath<Operation> {
  readonly operation: Operation;
  readonly segments: readonly [string, ...string[]];
}

export const validateUtilityPaths = <Operation>(
  operations: readonly Operation[],
  segmentsOf: (operation: Operation) => readonly string[],
  error: (operation: Operation, issue: InvalidUtilityPath) => Error
): readonly UtilityPath<Operation>[] => {
  const branches = new Map<string, readonly string[]>();
  const leaves = new Set<string>();
  return operations.map((operation) => {
    const segments = segmentsOf(operation);
    if (
      !EffectArray.isReadonlyArrayNonEmpty(segments) ||
      segments.some(
        (segment) => segment.length === 0 || reservedSegments.has(segment)
      )
    ) {
      throw error(operation, { kind: "invalid" });
    }
    const key = JSON.stringify(segments);
    if (leaves.has(key)) {
      throw error(operation, { kind: "duplicate", segments });
    }
    const descendant = branches.get(key);
    if (descendant !== undefined) {
      throw error(operation, { kind: "descendant", segments: descendant });
    }
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index);
      const parentKey = JSON.stringify(parent);
      if (leaves.has(parentKey)) {
        throw error(operation, { kind: "parent", segments: parent });
      }
      if (!branches.has(parentKey)) {
        branches.set(parentKey, segments);
      }
    }
    leaves.add(key);
    return { operation, segments };
  });
};
