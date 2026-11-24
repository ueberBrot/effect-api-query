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
  const { length } = value;
  if (Reflect.ownKeys(value).length !== length + 1) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      descriptor?.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
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

const canInspectAtom = (
  value: unknown,
  checked: Map<object, boolean>
): boolean => {
  if (!Predicate.isObjectOrArray(value)) {
    return true;
  }
  const previous = checked.get(value);
  if (previous !== undefined) {
    return previous;
  }
  checked.set(value, false);
  let safe: boolean;
  if (Array.isArray(value)) {
    safe =
      isPlainDenseArray(value) &&
      value.every((item) => canInspectAtom(item, checked));
  } else {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype === Object.prototype) {
      const keys = plainObjectKeys(value);
      safe =
        keys !== undefined &&
        keys.every((key) => canInspectAtom(value[key], checked));
    } else {
      safe = prototype !== null;
    }
  }
  checked.set(value, safe);
  return safe;
};

const setOwnDataProperty = (
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void => {
  if (key in target) {
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

const assertAcyclic = (
  value: unknown,
  ancestors: Set<object>,
  completed: Set<object>
): void => {
  if (!Predicate.isObjectOrArray(value) || completed.has(value)) {
    return;
  }
  if (ancestors.has(value)) {
    throw new TypeError("Schema sharing requires acyclic plain containers");
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (isPlainDenseArray(value)) {
      for (const item of value) {
        assertAcyclic(item, ancestors, completed);
      }
    }
  } else {
    for (const key of plainObjectKeys(value) ?? []) {
      assertAcyclic(value[key], ancestors, completed);
    }
  }
  ancestors.delete(value);
  completed.add(value);
};

type ShareNode = (previous: unknown, incoming: unknown) => unknown;

const shareArray = (
  previous: unknown,
  incoming: readonly unknown[],
  share: ShareNode
): unknown => {
  if (
    !isPlainDenseArray(incoming) ||
    !Array.isArray(previous) ||
    !isPlainDenseArray(previous)
  ) {
    return incoming;
  }
  const previousArray: readonly unknown[] = previous;
  const { length } = incoming;
  let sameAsPrevious: boolean = previousArray.length === length;
  let sameAsIncoming = true;
  let values: unknown[] | undefined;
  for (let index = 0; index < length; index += 1) {
    const next: unknown = incoming[index];
    const prev: unknown = previousArray[index];
    const shared = share(prev, next);
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
  share: ShareNode
): unknown => {
  const keys = plainObjectKeys(incoming);
  if (keys === undefined) {
    return incoming;
  }
  const oldKeys = Predicate.isObject(previous)
    ? plainObjectKeys(previous)
    : undefined;
  if (oldKeys === undefined || !Predicate.isObject(previous)) {
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
    const shared = share(prev, next);
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
  return (previous, incoming) => {
    assertAcyclic(incoming, new Set(), new Set());
    const checked = new Map<object, boolean>();
    const share: ShareNode = (oldValue, newValue) => {
      if (Object.is(oldValue, newValue)) {
        return oldValue;
      }
      if (canInspectAtom(newValue, checked)) {
        const canInspectPrevious = canInspectAtom(oldValue, checked);
        if (accepts(newValue)) {
          return canInspectPrevious &&
            accepts(oldValue) &&
            options.equivalence(oldValue, newValue)
            ? oldValue
            : newValue;
        }
      }
      if (Array.isArray(newValue)) {
        return shareArray(oldValue, newValue, share);
      }
      if (Predicate.isObject(newValue)) {
        return sharePlainObject(oldValue, newValue, share);
      }
      return newValue;
    };
    return share(previous, incoming);
  };
};
