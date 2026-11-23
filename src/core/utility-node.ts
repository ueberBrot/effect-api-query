import type { QueryKey } from "@tanstack/query-core";
import { Predicate } from "effect";

import type { RuntimeOptions } from "./configure";

export interface UtilityNode {
  readonly key: () => QueryKey;
}

export type RuntimeUtilityNode = RuntimeOptions & UtilityNode;

export interface LazyLeafSlot {
  readonly materialize: () => RuntimeUtilityNode;
  readonly ownerToken?: symbol | undefined;
}

const lazyLeafGetters = new WeakMap<
  NonNullable<PropertyDescriptor["get"]>,
  LazyLeafSlot
>();

export const defineLazyLeafDescriptor = (
  materialize: () => RuntimeUtilityNode,
  ownerToken?: symbol
): PropertyDescriptor => {
  let cached: RuntimeUtilityNode | undefined;
  const get = () => {
    cached ??= materialize();
    return cached;
  };
  lazyLeafGetters.set(get, { materialize: get, ownerToken });
  return {
    enumerable: true,
    configurable: false,
    get,
  };
};

const readLazyLeafSlot = (
  descriptor: PropertyDescriptor | undefined
): LazyLeafSlot | undefined => {
  // oxlint-disable-next-line typescript/unbound-method
  const getter = descriptor?.get;
  return getter === undefined ? undefined : lazyLeafGetters.get(getter);
};

const buildBranchFrom = (
  source: RuntimeUtilityNode,
  replacements: ReadonlyMap<string, PropertyDescriptor>
): RuntimeUtilityNode => {
  const next: RuntimeOptions = {};
  for (const name of Object.keys(source)) {
    const descriptor =
      replacements.get(name) ?? Object.getOwnPropertyDescriptor(source, name);
    if (descriptor !== undefined) {
      Object.defineProperty(next, name, descriptor);
    }
  }
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  return Object.freeze(next) as RuntimeUtilityNode;
};

export type UtilityChild =
  | { readonly kind: "branch"; readonly node: RuntimeUtilityNode }
  | { readonly kind: "lazy"; readonly slot: LazyLeafSlot };

export const isUtilityNode = (
  value: RuntimeUtilityNode[string]
): value is RuntimeUtilityNode =>
  Predicate.hasProperty(value, "key") && Predicate.isFunction(value.key);

export const readUtilityChild = (
  node: RuntimeUtilityNode,
  name: string
): UtilityChild | undefined => {
  if (name === "key" || name === "queryFilter") {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(node, name);
  if (descriptor?.enumerable !== true) {
    return undefined;
  }
  const slot = readLazyLeafSlot(descriptor);
  if (slot !== undefined) {
    return { kind: "lazy", slot };
  }
  if ("value" in descriptor && isUtilityNode(descriptor.value)) {
    return { kind: "branch", node: descriptor.value };
  }
  return undefined;
};

export const mapUtilityChildren = (
  node: RuntimeUtilityNode,
  mapBranch: (child: RuntimeUtilityNode, name: string) => RuntimeUtilityNode,
  mapLeaf: (slot: LazyLeafSlot, name: string) => LazyLeafSlot,
  names = Object.keys(node)
): RuntimeUtilityNode | undefined => {
  const replacements = new Map<string, PropertyDescriptor>();
  let hasChildren = false;
  for (const name of names) {
    const child = readUtilityChild(node, name);
    if (child === undefined) {
      continue;
    }
    hasChildren = true;
    if (child.kind === "lazy") {
      const next = mapLeaf(child.slot, name);
      if (next !== child.slot) {
        replacements.set(
          name,
          defineLazyLeafDescriptor(next.materialize, next.ownerToken)
        );
      }
    } else {
      const next = mapBranch(child.node, name);
      if (next !== child.node) {
        replacements.set(name, {
          value: next,
          enumerable: true,
          writable: false,
          configurable: false,
        });
      }
    }
  }
  const next =
    replacements.size === 0 ? node : buildBranchFrom(node, replacements);
  return hasChildren ? next : undefined;
};
