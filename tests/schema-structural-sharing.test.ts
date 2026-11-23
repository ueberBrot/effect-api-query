import { QueryClient } from "@tanstack/query-core";
import { Schema, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { schemaStructuralSharing } from "#effect-api-query";

import { Reading } from "./types/docs-structural-sharing";

const reading = (id: number) =>
  new Reading({
    id,
    observedAt: new Date(0),
    values: new Map([["a", id]]),
    labels: new Set(["a"]),
    note: Option.some("ok"),
    attachment: null,
  });

describe("Schema structural sharing", () => {
  it("shares equivalent decoded records in native cached containers", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          structuralSharing: schemaStructuralSharing(Reading, {
            equivalence: Schema.toEquivalence(Reading),
          }),
        },
      },
    });
    const key = ["readings"];
    const first = { readings: [reading(1), reading(2)] };
    client.setQueryData(key, first);
    client.setQueryData(key, { readings: [reading(1), reading(2)] });
    expect(client.getQueryData(key)).toBe(first);
    const incoming = { readings: [reading(1), reading(3)] };
    client.setQueryData(key, incoming);
    const changed = client.getQueryData<typeof first>(key);
    expect(changed?.readings[0]).toBe(first.readings[0]);
    expect(changed?.readings[1]).toBe(incoming.readings[1]);
    const all = { readings: [reading(4), reading(5)] };
    client.setQueryData(key, all);
    expect(client.getQueryData(key)).toBe(all);
    client.clear();
  });

  class StatefulReading extends Reading {
    #state = "first";
    static withState(state: string) {
      const value = new StatefulReading(reading(1));
      value.#state = state;
      return value;
    }
    state() {
      return this.#state;
    }
  }

  it("explicit equivalence includes private class state absent from the wire schema", () => {
    const fields = Schema.toEquivalence(Reading);
    const share = schemaStructuralSharing(Reading, {
      equivalence: (a, b) =>
        fields(a, b) &&
        a instanceof StatefulReading &&
        b instanceof StatefulReading &&
        a.state() === b.state(),
    });
    const client = new QueryClient({
      defaultOptions: { queries: { structuralSharing: share } },
    });
    const key = ["state"];
    const first = StatefulReading.withState("first");
    client.setQueryData(key, [first]);
    client.setQueryData(key, [StatefulReading.withState("first")]);
    expect(client.getQueryData(key)).toStrictEqual([first]);
    expect(client.getQueryData<StatefulReading[]>(key)?.[0]).toBe(first);
    const changed = StatefulReading.withState("changed");
    client.setQueryData(key, [changed]);
    expect(client.getQueryData<StatefulReading[]>(key)?.[0]).toBe(changed);
    client.clear();
  });

  it("unsupported and invalid atoms pass through without encoded comparison", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          structuralSharing: schemaStructuralSharing(Reading, {
            equivalence: Schema.toEquivalence(Reading),
          }),
        },
      },
    });
    for (const [old, next] of [
      [reading(1), { id: "invalid" }],
      [new URL("https://example.test"), new URL("https://example.test")],
      [new Map([["a", 1]]), new Map([["a", 1]])],
    ]) {
      const key = ["unsupported"];
      client.setQueryData(key, old);
      client.setQueryData(key, next);
      expect(client.getQueryData(key)).toBe(next);
    }
    client.clear();
  });

  it("preserves unsupported container state and rejects traversed cycles", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          structuralSharing: schemaStructuralSharing(Reading, {
            equivalence: Schema.toEquivalence(Reading),
          }),
        },
      },
    });
    const symbol = Symbol("state");
    const key = ["container"];
    client.setQueryData(key, { [symbol]: 1 });
    const next = { [symbol]: 2 };
    client.setQueryData(key, next);
    expect(client.getQueryData(key)).toBe(next);
    interface CyclicContainer {
      self?: CyclicContainer;
    }
    const cyclic: CyclicContainer = {};
    cyclic.self = cyclic;
    expect(() => client.setQueryData(key, cyclic)).toThrow(TypeError);
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    expect(() => client.setQueryData(["cyclic-array"], cyclicArray)).toThrow(
      TypeError
    );
    client.clear();
  });

  it("shares acyclic shared references and bails out on sparse, symbol, extra-key, getter, and non-enumerable containers", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          structuralSharing: schemaStructuralSharing(Reading, {
            equivalence: Schema.toEquivalence(Reading),
          }),
        },
      },
    });
    const shared = [reading(1)];
    const first = { left: shared, right: shared };
    client.setQueryData(["dag"], first);
    const incomingShared = [reading(1)];
    client.setQueryData(["dag"], {
      left: incomingShared,
      right: incomingShared,
    });

    const sparsePrev = [reading(1), undefined, reading(2)];
    const sparseNext: (Reading | undefined)[] = [];
    sparseNext[0] = reading(1);
    sparseNext[2] = reading(2);
    client.setQueryData(["sparse"], sparsePrev);
    client.setQueryData(["sparse"], sparseNext);

    const tag = Symbol("tag");
    const symArrayPrev = Object.assign([reading(1)], { [tag]: 1 });
    const symArrayNext = Object.assign([reading(1)], { [tag]: 2 });
    client.setQueryData(["sym-array"], symArrayPrev);
    client.setQueryData(["sym-array"], symArrayNext);

    const expandoPrev = Object.assign([reading(1)], { extra: 1 });
    const expandoNext = Object.assign([reading(1)], { extra: 2 });
    client.setQueryData(["expando-array"], expandoPrev);
    client.setQueryData(["expando-array"], expandoNext);

    const getterPrev = {
      get item() {
        return reading(1);
      },
    };
    const getterNext = {
      get item() {
        return reading(1);
      },
    };
    client.setQueryData(["getter"], getterPrev);
    client.setQueryData(["getter"], getterNext);

    const hiddenPrev = Object.defineProperty(
      { visible: reading(1) },
      "hidden",
      {
        enumerable: false,
        value: 1,
      }
    );
    const hiddenNext = Object.defineProperty(
      { visible: reading(1) },
      "hidden",
      {
        enumerable: false,
        value: 2,
      }
    );
    client.setQueryData(["non-enumerable"], hiddenPrev);
    client.setQueryData(["non-enumerable"], hiddenNext);
    expect({
      dag: client.getQueryData(["dag"]) === first,
      sparse: client.getQueryData(["sparse"]) === sparseNext,
      symbolArray: client.getQueryData(["sym-array"]) === symArrayNext,
      expandoArray: client.getQueryData(["expando-array"]) === expandoNext,
      getter: client.getQueryData(["getter"]) === getterNext,
      nonEnumerable: client.getQueryData(["non-enumerable"]) === hiddenNext,
    }).toStrictEqual({
      dag: true,
      sparse: true,
      symbolArray: true,
      expandoArray: true,
      getter: true,
      nonEnumerable: true,
    });
    client.clear();
  });

  it("preserves primitive distinctions and propagates equivalence defects synchronously", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          structuralSharing: schemaStructuralSharing(Reading, {
            equivalence: () => {
              throw new Error("policy defect");
            },
          }),
        },
      },
    });
    const key = ["validation"];
    client.setQueryData(key, { value: -0 });
    client.setQueryData(key, { value: 0 });
    expect(
      Object.is(client.getQueryData<{ value: number }>(key)?.value, 0)
    ).toBe(true);
    client.setQueryData(key, reading(1));
    expect(() => client.setQueryData(key, reading(1))).toThrow("policy defect");
    client.clear();
  });

  it("passes through arrays with accessors without reading their elements", () => {
    const share = schemaStructuralSharing(Reading, {
      equivalence: Schema.toEquivalence(Reading),
    });
    const incoming = Object.defineProperty([reading(1)], "0", {
      get: () => {
        throw new Error("Unexpected getter invocation");
      },
    });
    expect(share([reading(1)], incoming)).toBe(incoming);
  });

  it("leaves plain accessors untouched when a Schema validates containers", () => {
    const schema = Schema.Struct({
      nested: Schema.Struct({ item: Schema.Int }),
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          structuralSharing: schemaStructuralSharing(schema, {
            equivalence: Schema.toEquivalence(schema),
          }),
        },
      },
    });
    const key = ["accessor"];
    const plain = { nested: { item: 1 } };
    const accessor = {
      nested: {
        get item(): number {
          throw new Error("Unexpected getter invocation");
        },
      },
    };
    try {
      client.setQueryData(key, plain);
      client.setQueryData(key, accessor);
      expect(client.getQueryData(key)).toBe(accessor);
      client.setQueryData(key, plain);
      expect(client.getQueryData(key)).toBe(plain);
    } finally {
      client.clear();
    }
  });

  it("rejects cycles when previous and incoming share the same reference", () => {
    const share = schemaStructuralSharing(Reading, {
      equivalence: Schema.toEquivalence(Reading),
    });
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => share(cyclic, cyclic)).toThrow(TypeError);
  });
});
