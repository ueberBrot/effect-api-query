import { QueryClient } from "@tanstack/query-core";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { schemaStructuralSharing } from "#effect-api-query";

class StatefulArray extends Array<number> {
  readonly #state: string;

  constructor(state: string) {
    super();
    this.#state = state;
  }

  state() {
    return this.#state;
  }
}

describe("Schema sharing of unsupported array prototypes", () => {
  it.each([0, 1])("preserves incoming state with %i elements", (length) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          structuralSharing: schemaStructuralSharing(Schema.Finite, {
            equivalence: Object.is,
          }),
        },
      },
    });
    const previous = new StatefulArray("previous");
    const incoming = new StatefulArray("incoming");
    if (length > 0) {
      previous.push(1);
      incoming.push(1);
    }
    const key = ["custom-array", length];
    client.setQueryData(key, previous);
    client.setQueryData(key, incoming);
    expect(client.getQueryData(key)).toBe(incoming);
    expect(client.getQueryData<StatefulArray>(key)?.state()).toBe("incoming");
    client.clear();
  });
});
