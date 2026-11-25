import { Predicate } from "effect";

import type { JsonValue } from "./types";

const canonicalizeArrayInternal = (
  value: readonly unknown[],
  omitUndefined: boolean,
  seen: WeakSet<object>
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
    copy.push(canonicalizeValue(value[index], omitUndefined, seen));
  }

  seen.delete(value);
  return Object.freeze(copy);
};

const canonicalizeObjectInternal = (
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  value: Record<string, unknown>,
  omitUndefined: boolean,
  seen: WeakSet<object>
): JsonValue => {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Key values must contain only plain objects");
  }

  const keys = Object.keys(value);
  keys.sort();
  const copy: Record<string, JsonValue> = {};

  for (const key of keys) {
    const item = value[key];
    if (omitUndefined && item === undefined) {
      continue;
    }
    if (key === "__proto__" || key === "constructor") {
      throw new TypeError(
        "Key objects must not contain __proto__ or constructor properties"
      );
    }
    // oxlint-disable-next-line eslint/no-use-before-define
    copy[key] = canonicalizeValue(item, omitUndefined, seen);
  }

  seen.delete(value);
  return Object.freeze(copy);
};

const canonicalizeValue = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  omitUndefined: boolean,
  seen?: WeakSet<object>
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

  const tracker = seen ?? new WeakSet();
  if (Array.isArray(value)) {
    return canonicalizeArrayInternal(value, omitUndefined, tracker);
  }

  if (tracker.has(value)) {
    throw new TypeError("Key values must not contain cycles");
  }
  tracker.add(value);
  return canonicalizeObjectInternal(value, omitUndefined, tracker);
};

export const canonicalizeArray = (
  value: readonly unknown[],
  seen = new WeakSet()
): readonly JsonValue[] => canonicalizeArrayInternal(value, false, seen);

/** Copies strict JSON into the immutable representation used by keys and filters. */
export const canonicalize = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  seen?: WeakSet<object>
): JsonValue => canonicalizeValue(value, false, seen);

export const canonicalizeOmittingUndefined = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  seen?: WeakSet<object>
): JsonValue => canonicalizeValue(value, true, seen);
