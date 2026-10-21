import { Array as EffectArray, Order, Predicate } from "effect";

import type { JsonValue } from "./types";

export const canonicalizeArray = (
  value: readonly unknown[],
  seen = new WeakSet()
): readonly JsonValue[] => {
  if (seen.has(value)) {
    throw new TypeError("Key values must not contain cycles");
  }
  seen.add(value);
  const copy: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError("Key values must not contain sparse arrays");
    }
    // oxlint-disable-next-line eslint/no-use-before-define
    copy.push(canonicalize(value[index], seen));
  }
  seen.delete(value);
  return Object.freeze(copy);
};

const canonicalizeObject = (
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  value: Record<string, unknown>,
  seen: WeakSet<object>
): JsonValue => {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Key values must contain only plain objects");
  }
  const copy: Record<string, JsonValue> = {};
  for (const key of EffectArray.sort(Object.keys(value), Order.String)) {
    if (key === "__proto__" || key === "constructor") {
      throw new TypeError(
        "Key objects must not contain __proto__ or constructor properties"
      );
    }
    // oxlint-disable-next-line eslint/no-use-before-define
    copy[key] = canonicalize(value[key], seen);
  }
  seen.delete(value);
  return Object.freeze(copy);
};

/** Copies strict JSON into the immutable representation used by keys and filters. */
export const canonicalize = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  seen = new WeakSet()
): JsonValue => {
  if (
    value === null ||
    Predicate.isString(value) ||
    Predicate.isBoolean(value)
  ) {
    return value;
  }
  if (Predicate.isNumber(value)) {
    if (!Number.isFinite(value)) {
      throw new TypeError("Key values must contain only finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (!Predicate.isObjectOrArray(value)) {
    throw new TypeError("Key values must be JSON-safe");
  }
  if (Array.isArray(value)) {
    return canonicalizeArray(value, seen);
  }
  if (seen.has(value)) {
    throw new TypeError("Key values must not contain cycles");
  }
  seen.add(value);
  return canonicalizeObject(value, seen);
};
