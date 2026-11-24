import type { QueryKey } from "@tanstack/query-core";
import { Predicate } from "effect";

import type { JsonValue } from "./types";

const keyVersion = "effect-api-query:v2:";

type UtilityNamespace = `${typeof keyVersion}${string}`;

export type UtilityRootKey<
  Prefix extends readonly JsonValue[],
  Namespace extends readonly string[],
> = readonly [
  Prefix extends readonly [] ? `${typeof keyVersion}[]` : UtilityNamespace,
  ...Namespace,
];

export const utilityRootKey = (
  prefix: readonly JsonValue[],
  namespace: readonly string[]
): readonly [UtilityNamespace, ...string[]] =>
  Object.freeze([`${keyVersion}${JSON.stringify(prefix)}`, ...namespace]);

export type UtilityOperationKey<
  Root extends readonly JsonValue[],
  Path extends readonly string[],
> = readonly [...Root, ...Path, null];

export const utilityOperationKey = <
  Root extends readonly JsonValue[],
  Path extends readonly string[],
>(
  root: Root,
  path: Path
): UtilityOperationKey<Root, Path> =>
  Object.freeze([...root, ...path, null] as const);

export const generatedViewKeyLimit = (prefix: QueryKey): number => {
  const [namespace] = prefix;
  if (
    !Predicate.isString(namespace) ||
    !namespace.startsWith(keyVersion) ||
    prefix.at(-2) !== null
  ) {
    return Number.POSITIVE_INFINITY;
  }
  switch (prefix.at(-1)) {
    case "query":
    case "metadata":
    case "infinite": {
      return prefix.length + 1;
    }
    case "live":
    case "streamed": {
      return prefix.length + 2;
    }
    default: {
      return Number.POSITIVE_INFINITY;
    }
  }
};
