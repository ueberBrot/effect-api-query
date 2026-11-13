import type { Equivalence } from "effect";
import { Predicate, Schema } from "effect";

/** An atomic decoded-value policy; include all meaningful instance state. */
export interface SchemaStructuralSharingOptions<T> {
  readonly equivalence: Equivalence.Equivalence<T>;
}

// Unknown is intentional at Query Core's sharing boundary. Validate atoms with
// the supplied Schema; inspect descriptors before traversing plain containers.
type SharingContainer =
  | { readonly [key: PropertyKey]: unknown }
  | readonly unknown[];

const containerKeys = (
  value: SharingContainer
): readonly string[] | undefined => {
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") {
      continue;
    }
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
  if (
    array &&
    (keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)))
  ) {
    return undefined;
  }
  return keys;
};

const assertAcyclic = (value: unknown, ancestors: WeakSet<object>): void => {
  if (!Predicate.isObject(value) && !Array.isArray(value)) {
    return;
  }
  const keys = containerKeys(value);
  if (keys === undefined) {
    return;
  }
  if (ancestors.has(value)) {
    throw new TypeError("Schema sharing requires acyclic plain containers");
  }
  ancestors.add(value);
  for (const child of Object.values(value)) {
    assertAcyclic(child, ancestors);
  }
  ancestors.delete(value);
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
  const share = (previous: unknown, incoming: unknown): unknown => {
    if (Object.is(previous, incoming)) {
      return previous;
    }
    if (accepts(incoming)) {
      return accepts(previous) && options.equivalence(previous, incoming)
        ? previous
        : incoming;
    }
    if (Array.isArray(previous) && Array.isArray(incoming)) {
      if (
        containerKeys(previous) === undefined ||
        containerKeys(incoming) === undefined
      ) {
        return incoming;
      }
      const values = incoming.map((value, index) =>
        share(previous[index], value)
      );
      if (
        previous.length === incoming.length &&
        values.every((value, index) => Object.is(value, previous[index]))
      ) {
        return previous;
      }
      return values.every((value, index) => Object.is(value, incoming[index]))
        ? incoming
        : values;
    }
    if (Predicate.isObject(previous) && Predicate.isObject(incoming)) {
      const keys = containerKeys(incoming);
      const oldKeys = containerKeys(previous);
      if (keys === undefined || oldKeys === undefined) {
        return incoming;
      }
      const values = Object.fromEntries(
        keys.map((key) => [key, share(previous[key], incoming[key])])
      );
      if (
        keys.length === oldKeys.length &&
        keys.every(
          (key) =>
            Object.hasOwn(previous, key) &&
            Object.is(values[key], previous[key])
        )
      ) {
        return previous;
      }
      return keys.every((key) => Object.is(values[key], incoming[key]))
        ? incoming
        : values;
    }
    return incoming;
  };
  return (previous, incoming) => {
    assertAcyclic(incoming, new WeakSet());
    return share(previous, incoming);
  };
};
