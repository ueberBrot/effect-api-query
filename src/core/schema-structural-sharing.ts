import type { Equivalence } from "effect";
import { Predicate, Schema } from "effect";

/** An atomic decoded-value policy; include all meaningful instance state. */
export interface SchemaStructuralSharingOptions<T> {
  readonly equivalence: Equivalence.Equivalence<T>;
}

interface PlainObject {
  readonly [key: PropertyKey]: unknown;
}

const isPlainDenseArray = (value: readonly unknown[]): boolean => {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }
  const { length } = value;
  if (Object.keys(value).length !== length) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return false;
    }
  }
  return true;
};

const plainObjectKeys = (value: PlainObject): readonly string[] | undefined => {
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !Predicate.isString(key) ||
      descriptor?.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return undefined;
    }
    keys.push(key);
  }
  return keys;
};

const setOwnDataProperty = (
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void => {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  } else {
    target[key] = value;
  }
};

const assertAcyclic = (value: unknown, ancestors: Set<object>): void => {
  if (Array.isArray(value)) {
    if (!isPlainDenseArray(value)) {
      return;
    }
    if (ancestors.has(value)) {
      throw new TypeError("Schema sharing requires acyclic plain containers");
    }
    ancestors.add(value);
    for (const item of value) {
      assertAcyclic(item, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (!Predicate.isObject(value)) {
    return;
  }
  const keys = plainObjectKeys(value);
  if (keys === undefined) {
    return;
  }
  if (ancestors.has(value)) {
    throw new TypeError("Schema sharing requires acyclic plain containers");
  }
  ancestors.add(value);
  for (const key of keys) {
    assertAcyclic(value[key], ancestors);
  }
  ancestors.delete(value);
};

type ShareNode = (
  previous: unknown,
  incoming: unknown,
  ancestors: Set<object>
) => unknown;

const shareArray = (
  previous: unknown,
  incoming: readonly unknown[],
  ancestors: Set<object>,
  share: ShareNode
): unknown => {
  if (!isPlainDenseArray(incoming)) {
    return incoming;
  }
  if (ancestors.has(incoming)) {
    throw new TypeError("Schema sharing requires acyclic plain containers");
  }
  ancestors.add(incoming);
  if (!Array.isArray(previous) || !isPlainDenseArray(previous)) {
    for (const item of incoming) {
      assertAcyclic(item, ancestors);
    }
    ancestors.delete(incoming);
    return incoming;
  }
  const previousArray: readonly unknown[] = previous;
  const { length } = incoming;
  let sameAsPrevious: boolean = previousArray.length === length;
  let sameAsIncoming = true;
  let values: unknown[] | undefined;
  for (let index = 0; index < length; index += 1) {
    const next: unknown = incoming[index];
    const prev: unknown =
      index < previousArray.length ? previousArray[index] : undefined;
    const shared = share(prev, next, ancestors);
    if (values === undefined) {
      const matchesPrevious: boolean =
        sameAsPrevious && Object.is(shared, prev);
      const matchesIncoming: boolean =
        sameAsIncoming && Object.is(shared, next);
      if (!matchesPrevious && !matchesIncoming) {
        values = Array.from({ length });
        for (let prior = 0; prior < index; prior += 1) {
          values[prior] = sameAsPrevious
            ? previousArray[prior]
            : incoming[prior];
        }
        values[index] = shared;
      }
      sameAsPrevious = matchesPrevious;
      sameAsIncoming = matchesIncoming;
    } else {
      values[index] = shared;
    }
  }
  ancestors.delete(incoming);
  if (values !== undefined) {
    return values;
  }
  return sameAsPrevious ? previousArray : incoming;
};

const copyPrefixProperties = (
  target: Record<string, unknown>,
  keys: readonly string[],
  count: number,
  source: PlainObject
): void => {
  for (let prior = 0; prior < count; prior += 1) {
    const priorKey = keys[prior];
    if (priorKey !== undefined) {
      setOwnDataProperty(target, priorKey, source[priorKey]);
    }
  }
};

const sharePlainObject = (
  previous: unknown,
  incoming: PlainObject,
  ancestors: Set<object>,
  share: ShareNode
): unknown => {
  const keys = plainObjectKeys(incoming);
  if (keys === undefined) {
    return incoming;
  }
  if (ancestors.has(incoming)) {
    throw new TypeError("Schema sharing requires acyclic plain containers");
  }
  ancestors.add(incoming);
  const oldKeys = Predicate.isObject(previous)
    ? plainObjectKeys(previous)
    : undefined;
  if (oldKeys === undefined || !Predicate.isObject(previous)) {
    for (const key of keys) {
      assertAcyclic(incoming[key], ancestors);
    }
    ancestors.delete(incoming);
    return incoming;
  }
  let sameAsPrevious: boolean = keys.length === oldKeys.length;
  let sameAsIncoming = true;
  let values: Record<string, unknown> | undefined;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) {
      continue;
    }
    const hasPrevious = Object.hasOwn(previous, key);
    const prev = hasPrevious ? previous[key] : undefined;
    const next = incoming[key];
    const shared = share(prev, next, ancestors);
    if (values === undefined) {
      const matchesPrevious: boolean =
        sameAsPrevious && hasPrevious && Object.is(shared, prev);
      const matchesIncoming: boolean =
        sameAsIncoming && Object.is(shared, next);
      if (!matchesPrevious && !matchesIncoming) {
        values = {};
        copyPrefixProperties(
          values,
          keys,
          index,
          sameAsPrevious ? previous : incoming
        );
        setOwnDataProperty(values, key, shared);
      }
      sameAsPrevious = matchesPrevious;
      sameAsIncoming = matchesIncoming;
    } else {
      setOwnDataProperty(values, key, shared);
    }
  }
  ancestors.delete(incoming);
  return values ?? (sameAsPrevious ? previous : incoming);
};

/**
 * Opt-in positional sharing of immutable decoded atoms inside plain containers.
 * The schema validates atoms, never encodes or decodes them. Its type-side
 * checks and equivalence must be synchronous and service-free. Invalid atoms
 * and unsupported objects pass through; callback defects propagate.
 */
export const schemaStructuralSharing = <T>(
  schema: Schema.Schema<T>,
  options: SchemaStructuralSharingOptions<NoInfer<T>>
): ((previous: unknown, incoming: unknown) => unknown) => {
  const accepts = Schema.is(schema);
  const share: ShareNode = (previous, incoming, ancestors) => {
    if (Object.is(previous, incoming)) {
      return previous;
    }
    if (accepts(incoming)) {
      return accepts(previous) && options.equivalence(previous, incoming)
        ? previous
        : incoming;
    }
    if (Array.isArray(incoming)) {
      return shareArray(previous, incoming, ancestors, share);
    }
    if (Predicate.isObject(incoming)) {
      return sharePlainObject(previous, incoming, ancestors, share);
    }
    return incoming;
  };
  return (previous, incoming) => share(previous, incoming, new Set());
};
