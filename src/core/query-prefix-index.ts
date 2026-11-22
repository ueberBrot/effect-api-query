import { hashKey } from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/query-core";
import { Array as EffectArray, Order, Predicate } from "effect";

type PrimitiveSegment = string | number | boolean;

const isPrimitiveSegment = (
  value: QueryKey[number]
): value is PrimitiveSegment =>
  Predicate.isString(value) ||
  Predicate.isBoolean(value) ||
  (Predicate.isNumber(value) && Number.isFinite(value));

export const compileQueryPrefix = (prefix: QueryKey) => {
  const hash = hashKey(prefix);
  const { length } = prefix;
  const lastIndex = length - 1;
  const last = prefix[lastIndex];
  const first = length > 1 ? prefix[0] : undefined;
  const checkLast = isPrimitiveSegment(last);
  const checkFirst = isPrimitiveSegment(first);

  return (key: QueryKey): boolean => {
    if (key.length < length) {
      return false;
    }
    const keyLast = key[lastIndex];
    if (checkLast && isPrimitiveSegment(keyLast) && keyLast !== last) {
      return false;
    }
    const [keyFirst] = key;
    return (
      (!checkFirst || !isPrimitiveSegment(keyFirst) || keyFirst === first) &&
      hashKey(key.slice(0, length)) === hash
    );
  };
};

const collectSegment = (
  segments: Set<PrimitiveSegment> | undefined,
  segment: QueryKey[number]
): Set<PrimitiveSegment> | undefined =>
  segments !== undefined && isPrimitiveSegment(segment)
    ? segments.add(segment)
    : undefined;

const canMatchSegment = (
  segments: ReadonlySet<PrimitiveSegment> | undefined,
  segment: QueryKey[number]
): boolean =>
  segments === undefined ||
  !isPrimitiveSegment(segment) ||
  segments.has(segment);

export const indexQueryPrefixes = <Value>(
  entries: Iterable<readonly [QueryKey, Value]>,
  options: {
    readonly order?: "discovery" | "longest-first";
    readonly duplicateError?: () => Error;
  } = {}
) => {
  interface Bucket {
    readonly length: number;
    readonly values: Map<string, Value>;
    first: Set<PrimitiveSegment> | undefined;
    last: Set<PrimitiveSegment> | undefined;
  }

  const byLength = new Map<number, Bucket>();
  let minLength = Number.POSITIVE_INFINITY;
  for (const [prefix, value] of entries) {
    const { length } = prefix;
    let bucket = byLength.get(length);
    if (bucket === undefined) {
      bucket = {
        length,
        values: new Map(),
        first: length > 1 ? new Set() : undefined,
        last: length > 0 ? new Set() : undefined,
      };
      byLength.set(length, bucket);
      minLength = Math.min(minLength, length);
    }
    const hash = hashKey(prefix);
    if (options.duplicateError !== undefined && bucket.values.has(hash)) {
      throw options.duplicateError();
    }
    bucket.values.set(hash, value);
    bucket.first = collectSegment(bucket.first, prefix[0]);
    bucket.last = collectSegment(bucket.last, prefix[length - 1]);
  }

  const buckets =
    options.order === "discovery"
      ? [...byLength.values()]
      : EffectArray.sort(
          byLength.values(),
          Order.mapInput(
            Order.flip(Order.Number),
            (bucket: Bucket) => bucket.length
          )
        );

  return (key: QueryKey): Value | undefined => {
    if (key.length < minLength) {
      return undefined;
    }
    for (const { length, values, first, last } of buckets) {
      if (
        key.length >= length &&
        canMatchSegment(last, key[length - 1]) &&
        canMatchSegment(first, key[0])
      ) {
        const value = values.get(hashKey(key.slice(0, length)));
        if (value !== undefined) {
          return value;
        }
      }
    }
    return undefined;
  };
};
