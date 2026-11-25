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

interface PathTrieNode {
  readonly children: Map<string, PathTrieNode>;
  leaf: boolean;
  firstDescendant?: readonly string[] | undefined;
}

const createTrieNode = (): PathTrieNode => ({
  children: new Map(),
  leaf: false,
});

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
  const root = createTrieNode();

  for (const operation of operations) {
    const { path } = operation;
    if (path.length === 0) {
      throw error(operation, "invalid", path);
    }
    for (const segment of path) {
      if (!segment || reservedSegments.has(segment)) {
        throw error(operation, "invalid", path);
      }
    }

    let current = root;
    for (let index = 0; index < path.length; index += 1) {
      const segment = path[index];
      if (segment === undefined) {
        throw error(operation, "invalid", path);
      }
      if (current.leaf) {
        throw error(operation, "parent", path.slice(0, index));
      }

      let child = current.children.get(segment);
      if (child === undefined) {
        child = createTrieNode();
        current.children.set(segment, child);
      }
      if (index < path.length - 1 && child.firstDescendant === undefined) {
        child.firstDescendant = path;
      }
      current = child;
    }

    if (current.leaf) {
      throw error(operation, "duplicate", path);
    }
    if (current.children.size > 0) {
      throw error(operation, "descendant", current.firstDescendant ?? path);
    }
    current.leaf = true;
  }
};
