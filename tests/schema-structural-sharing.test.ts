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
});
