import { QueryClient } from "@tanstack/query-core";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Predicate,
  Redacted,
  Schema,
  Scope,
} from "effect";
import { HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from "effect/http-api";
import { describe, expect, it } from "vite-plus/test";

import { createHttpApiQueryUtils } from "#effect-api-query";
import type { JsonValue } from "#effect-api-query";

import { makeUnusedHttpClient } from "./fixtures/http-client";

const api = HttpApi.make("keys").add(
  HttpApiGroup.make("requests").add(
    HttpApiEndpoint.post("save", "/save", {
      query: { filter: Schema.optional(Schema.String) },
      headers: Schema.Record(Schema.String, Schema.optional(Schema.String)),
      payload: Schema.NullOr(
        Schema.Struct({
          nested: Schema.Struct({
            absent: Schema.optional(Schema.String),
            kept: Schema.Array(Schema.Finite),
          }),
        })
      ),
    })
  )
);
const utils = createHttpApiQueryUtils(api, {
  client: Effect.runSync(makeUnusedHttpClient(api)),
  keyPrefix: ["test"],
});

const encodeTestKey = (encode: () => JsonValue) =>
  createHttpApiQueryUtils(api, {
    client: Effect.runSync(makeUnusedHttpClient(api)),
    keyPrefix: ["test"],
    keyEncoders: { requests: { save: encode } },
  });

describe("HTTP semantic keys", () => {
  it("preserves singleton and multi-value arrays in GET and form-urlencoded payloads", async () => {
    const fields = Schema.Struct({ values: Schema.Array(Schema.String) });
    const contract = HttpApi.make("array-payloads").add(
      HttpApiGroup.make("formats", { topLevel: true }).add(
        HttpApiEndpoint.get("search", "/search", {
          payload: fields.fields,
          success: Schema.Array(Schema.String),
        }),
        HttpApiEndpoint.post("form", "/form", {
          payload: fields.pipe(HttpApiSchema.asFormUrlEncoded()),
          success: Schema.Array(Schema.String),
        })
      )
    );
    const handlers = HttpApiBuilder.group(contract, "formats", (group) =>
      group
        .handle("search", ({ payload }) => Effect.succeed(payload.values))
        .handle("form", ({ payload }) => Effect.succeed(payload.values))
    );
    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      HttpApiTest.groups(contract, ["formats"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope)
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client,
      keyPrefix: ["array-payloads"],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    try {
      await Promise.all(
        [["one"], ["one", "two"]].map(async (values) => {
          await expect(
            queryClient.query(
              http.search.queryOptions({ input: { payload: { values } } })
            )
          ).resolves.toStrictEqual(values);
          await expect(
            queryClient.query(
              http.form.queryOptions({ input: { payload: { values } } })
            )
          ).resolves.toStrictEqual(values);
        })
      );
    } finally {
      queryClient.clear();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("reuses equivalent requests and partitions every result-affecting request part", async () => {
    const contract = HttpApi.make("cache").add(
      HttpApiGroup.make("requests").add(
        HttpApiEndpoint.post("read", "/:id", {
          params: { id: Schema.FiniteFromString },
          query: { filter: Schema.optional(Schema.String) },
          headers: Schema.Record(Schema.String, Schema.optional(Schema.String)),
          payload: Schema.Struct({ name: Schema.String }),
          success: Schema.String,
        })
      )
    );
    let calls = 0;
    const handlers = HttpApiBuilder.group(contract, "requests", (group) =>
      group.handle("read", ({ params, query, payload, headers }) => {
        calls += 1;
        return Effect.succeed(
          JSON.stringify([
            params.id,
            query.filter,
            payload.name,
            headers["x-locale"],
          ])
        );
      })
    );
    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      HttpApiTest.groups(contract, ["requests"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope)
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client,
      keyPrefix: ["test"],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const input = {
      params: { id: 1 },
      query: {},
      headers: { "X-Locale": "en" },
      payload: { name: "Ada" },
    };
    try {
      const read = async (
        request: Parameters<typeof http.requests.read.queryKey>[0]
      ) =>
        await queryClient.query(
          http.requests.read.queryOptions({ input: request })
        );
      const original = await read(input);
      const equivalent = await read({
        ...input,
        query: { filter: undefined },
        headers: { "x-locale": "en" },
      });
      expect({ original, equivalent, calls }).toStrictEqual({
        original: '[1,null,"Ada","en"]',
        equivalent: '[1,null,"Ada","en"]',
        calls: 1,
      });
      const results = {
        params: await read({ ...input, params: { id: 2 } }),
        query: await read({ ...input, query: { filter: "active" } }),
        payload: await read({ ...input, payload: { name: "Grace" } }),
        headers: await read({ ...input, headers: { "X-Locale": "de" } }),
      };
      expect({ results, calls }).toStrictEqual({
        results: {
          params: '[2,null,"Ada","en"]',
          query: '[1,"active","Ada","en"]',
          payload: '[1,null,"Grace","en"]',
          headers: '[1,null,"Ada","de"]',
        },
        calls: 5,
      });
    } finally {
      queryClient.clear();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("encodes text, form, URL payloads, and binary requests through the ready client", async () => {
    const fields = Schema.Struct({
      page: Schema.FiniteFromString,
      filter: Schema.optional(Schema.String),
    });
    const contract = HttpApi.make("formats").add(
      HttpApiGroup.make("formats", { topLevel: true }).add(
        HttpApiEndpoint.post("text", "/text", {
          payload: Schema.FiniteFromString.pipe(HttpApiSchema.asText()),
          success: Schema.Finite,
        }),
        HttpApiEndpoint.post("form", "/form", {
          payload: fields.pipe(HttpApiSchema.asFormUrlEncoded()),
          success: Schema.Finite,
        }),
        HttpApiEndpoint.get("search", "/search", {
          payload: fields.fields,
          query: { sort: Schema.String },
          success: Schema.String,
        }),
        HttpApiEndpoint.post("binary", "/binary", {
          payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
          success: Schema.Finite,
        })
      )
    );
    const handlers = HttpApiBuilder.group(contract, "formats", (group) =>
      group
        .handle("text", ({ payload }) => Effect.succeed(payload))
        .handle("form", ({ payload }) => Effect.succeed(payload.page))
        .handle("search", ({ payload, query }) =>
          Effect.succeed(`${payload.page}:${query.sort}`)
        )
        .handle("binary", ({ payload }) => {
          const [firstByte] = payload;
          if (firstByte === undefined) {
            return Effect.die(new Error("Expected a nonempty binary payload"));
          }
          return Effect.succeed(firstByte);
        })
    );
    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      HttpApiTest.groups(contract, ["formats"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope)
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client,
      keyPrefix: ["formats"],
      keyEncoders: {
        formats: { binary: ({ payload }) => ({ bytes: [...payload] }) },
      },
    });
    const queryClient = new QueryClient();
    try {
      expect({
        key: http.text.queryKey({ payload: 42 }).at(-1),
        data: await queryClient.query(
          http.text.queryOptions({ input: { payload: 42 } })
        ),
      }).toStrictEqual({ key: { payload: "42" }, data: 42 });
      expect({
        key: http.form
          .queryKey({ payload: { page: 2, filter: undefined } })
          .at(-1),
        data: await queryClient.query(
          http.form.queryOptions({ input: { payload: { page: 2 } } })
        ),
      }).toStrictEqual({ key: { payload: { page: "2" } }, data: 2 });
      const search = { payload: { page: 3 }, query: { sort: "name" } };
      expect({
        key: http.search.queryKey(search).at(-1),
        data: await queryClient.query(
          http.search.queryOptions({ input: search })
        ),
      }).toStrictEqual({
        key: { payload: { page: "3" }, query: { sort: "name" } },
        data: "3:name",
      });
      await expect(
        queryClient.query(
          http.binary.queryOptions({ input: { payload: new Uint8Array([7]) } })
        )
      ).resolves.toBe(7);
      const defaults = createHttpApiQueryUtils(contract, {
        client,
        keyPrefix: ["default"],
      });
      expect(() =>
        defaults.binary.queryKey({ payload: new Uint8Array([7]) })
      ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));
    } finally {
      queryClient.clear();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("omits undefined members and normalizes header names without changing the input", () => {
    const input = {
      query: { filter: undefined },
      headers: { "X-Locale": "en", "x-locale": "en", ignored: undefined },
      payload: { nested: { kept: [2, 1] } },
    };
    const key = utils.requests.save.queryKey(input);
    expect(key.at(-1)).toStrictEqual({
      query: {},
      headers: { "x-locale": "en" },
      payload: { nested: { kept: [2, 1] } },
    });
    expect(key).toStrictEqual(
      utils.requests.save.queryKey({
        query: {},
        headers: { "x-locale": "en" },
        payload: { nested: { kept: [2, 1] } },
      })
    );
    expect(input).toStrictEqual({
      query: { filter: undefined },
      headers: { "X-Locale": "en", "x-locale": "en", ignored: undefined },
      payload: { nested: { kept: [2, 1] } },
    });
    expect({
      headersFrozen: Object.isFrozen(input.headers),
      valuesFrozen: Object.isFrozen(input.payload.nested.kept),
    }).toStrictEqual({ headersFrozen: false, valuesFrozen: false });
    input.payload.nested.kept[0] = 99;
    expect({
      value: key.at(-1),
      keyFrozen: Object.isFrozen(key),
      valueFrozen: Object.isFrozen(key.at(-1)),
    }).toStrictEqual({
      value: {
        query: {},
        headers: { "x-locale": "en" },
        payload: { nested: { kept: [2, 1] } },
      },
      keyFrozen: true,
      valueFrozen: true,
    });
  });

  it("rejects conflicting case-insensitive headers before invocation", () => {
    expect(() =>
      utils.requests.save.queryOptions({
        input: {
          query: {},
          headers: { "X-Locale": "en", "x-locale": "de" },
          payload: null,
        },
      })
    ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));
  });

  it("omits nested undefined query members while preserving shared caller values", () => {
    const contract = HttpApi.make("nested").add(
      HttpApiGroup.make("requests").add(
        HttpApiEndpoint.get("read", "/read", {
          query: {
            rows: Schema.Array(
              Schema.Struct({
                id: Schema.String,
                absent: Schema.optional(Schema.String),
              })
            ),
          },
        })
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client: Effect.runSync(makeUnusedHttpClient(contract)),
      keyPrefix: ["test"],
    });
    const shared = { id: "first" };
    const input = {
      query: { rows: [shared, { id: "second", absent: undefined }, shared] },
    };
    const key = http.requests.read.queryKey(input);

    expect(key.at(-1)).toStrictEqual({
      query: { rows: [{ id: "first" }, { id: "second" }, { id: "first" }] },
    });
    expect(input.query.rows[0]).toBe(shared);
    expect({
      row: input.query.rows[1],
      rowsFrozen: Object.isFrozen(input.query.rows),
    }).toStrictEqual({
      row: { id: "second", absent: undefined },
      rowsFrozen: false,
    });
    expect(input.query.rows[2]).toBe(shared);
    shared.id = "changed";
    expect(key.at(-1)).toStrictEqual({
      query: { rows: [{ id: "first" }, { id: "second" }, { id: "first" }] },
    });
  });

  it("preserves array order and rejects missing array entries in default request keys", () => {
    const contract = HttpApi.make("arrays").add(
      HttpApiGroup.make("search").add(
        HttpApiEndpoint.get("find", "/find", {
          query: { values: Schema.Array(Schema.String) },
        })
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client: Effect.runSync(makeUnusedHttpClient(contract)),
      keyPrefix: ["test"],
    });
    expect(
      http.search.find.queryKey({ query: { values: ["b", "a"] } }).at(-1)
    ).toStrictEqual({
      query: { values: ["b", "a"] },
    });
    expect(
      http.search.find.queryKey({ query: { values: ["b", "a"] } })
    ).not.toStrictEqual(
      http.search.find.queryKey({ query: { values: ["a", "b"] } })
    );
    /* oxlint-disable unicorn/no-new-array */
    for (const values of [new Array<unknown>(1), [undefined]]) {
      /* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
      expect(() =>
        http.search.find.queryOptions({ input: { query: { values } } } as never)
      ).toThrow(
        expect.objectContaining({ _tag: "EffectHttpApiQueryKeyError" })
      );
      /* oxlint-enable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
    }
    /* oxlint-enable unicorn/no-new-array */
  });

  it("rejects inherited array entries in default request keys", () => {
    const contract = HttpApi.make("inherited").add(
      HttpApiGroup.make("requests").add(
        HttpApiEndpoint.post("read", "/read", { payload: Schema.Unknown })
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client: Effect.runSync(makeUnusedHttpClient(contract)),
      keyPrefix: ["test"],
    });
    const values = ["removed", "present"];
    Reflect.deleteProperty(values, "0");
    const prototype = { 0: "inherited" };
    Object.setPrototypeOf(prototype, Array.prototype);
    Object.setPrototypeOf(values, prototype);

    expect(() => http.requests.read.queryKey({ payload: values })).toThrow(
      expect.objectContaining({ code: "InvalidKeyValue" })
    );
    expect(() =>
      http.requests.read.queryOptions({ input: { payload: values } })
    ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));
  });

  it("keeps custom encoder output strict, copied, and deeply frozen", () => {
    const input = { query: {}, headers: {}, payload: null };
    const value = { nested: { values: [2, 1] } };
    const key = encodeTestKey(() => value).requests.save.queryKey(input);
    value.nested.values.push(3);
    expect(key.at(-1)).toStrictEqual({ nested: { values: [2, 1] } });
    const encoded = key.at(-1);
    if (
      !Predicate.isObject(encoded) ||
      !Predicate.isObject(encoded["nested"])
    ) {
      throw new TypeError("Expected a nested canonical key value");
    }
    expect(Object.isFrozen(encoded["nested"]["values"])).toBe(true);
    interface Cycle {
      self?: Cycle;
    }
    const cycle: Cycle = {};
    cycle.self = cycle;
    /* oxlint-disable unicorn/no-new-array */
    for (const invalid of [
      undefined,
      { absent: undefined },
      [undefined],
      new Array<unknown>(1),
      Number.NaN,
      Infinity,
      1n,
      new Date(),
      new Uint8Array([1]),
      cycle,
      () => null,
    ]) {
      /* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
      expect(() =>
        encodeTestKey(() => invalid as never).requests.save.queryOptions({
          input,
        })
      ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));
      /* oxlint-enable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
    }
    /* oxlint-enable unicorn/no-new-array */
  });

  it("validates the declaration-based encoder map atomically, including empty unknown groups", () => {
    const contract = HttpApi.make("maps").add(
      HttpApiGroup.make("forms.v1", { topLevel: true }).add(
        HttpApiEndpoint.post("save.one", "/save", {
          payload: [Schema.String, Schema.Finite],
        }),
        HttpApiEndpoint.get("ping", "/ping"),
        HttpApiEndpoint.post("upload", "/upload", {
          payload: Schema.Struct({ file: Schema.String }).pipe(
            HttpApiSchema.asMultipart()
          ),
        })
      )
    );
    let encoded = false;
    const encode = () => {
      encoded = true;
      return null;
    };
    for (const keyEncoders of [
      { unknown: {} },
      { "forms.v1.save.one": encode },
      { "forms.v1": { unknown: encode } },
      { "forms.v1": { ping: encode } },
      { "forms.v1": { upload: encode } },
    ]) {
      /* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
      expect(() =>
        createHttpApiQueryUtils(contract, {
          client: Effect.runSync(makeUnusedHttpClient(contract)),
          keyPrefix: ["test"],
          keyEncoders,
        } as never)
      ).toThrow(expect.objectContaining({ code: "UnknownKeyEncoder" }));
      /* oxlint-enable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
    }
    expect(encoded).toBe(false);
    const custom = createHttpApiQueryUtils(contract, {
      client: Effect.runSync(makeUnusedHttpClient(contract)),
      keyPrefix: ["test"],
      keyEncoders: {
        "forms.v1": {
          "save.one": ({ payload }) => ({
            kind: Predicate.isNumber(payload) ? "number" : "string",
            value: payload,
          }),
        },
      },
    });
    expect(custom["save.one"].queryKey({ payload: 1 }).at(-1)).toStrictEqual({
      kind: "number",
      value: 1,
    });
  });

  it("distinguishes equal encoded scalars sent with different payload encodings", async () => {
    const contract = HttpApi.make("alternatives").add(
      HttpApiGroup.make("forms").add(
        HttpApiEndpoint.post("submit", "/submit", {
          payload: [
            Schema.FiniteFromString.pipe(HttpApiSchema.asText()),
            Schema.String,
          ],
          success: Schema.String,
        })
      )
    );
    const handlers = HttpApiBuilder.group(contract, "forms", (group) =>
      group.handle("submit", ({ payload }) =>
        Effect.succeed(
          `${Predicate.isNumber(payload) ? "number" : "string"}:${payload}`
        )
      )
    );
    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      HttpApiTest.groups(contract, ["forms"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope)
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client,
      keyPrefix: ["test"],
      keyEncoders: {
        forms: {
          submit: ({ payload }) => ({
            format: Predicate.isNumber(payload) ? "text" : "json",
            value: String(payload),
          }),
        },
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });
    try {
      await expect(
        queryClient.query(
          http.forms.submit.queryOptions({ input: { payload: 1 } })
        )
      ).resolves.toBe("number:1");
      await expect(
        queryClient.query(
          http.forms.submit.queryOptions({ input: { payload: "1" } })
        )
      ).resolves.toBe("string:1");
      expect(http.forms.submit.queryKey({ payload: 1 })).not.toStrictEqual(
        http.forms.submit.queryKey({ payload: "1" })
      );
    } finally {
      queryClient.clear();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("requires an encoder for Redacted values and opaque encoding middleware in every request part", () => {
    class Encoding extends Context.Service<Encoding, Record<string, never>>()(
      "HttpKeys/Encoding"
    ) {}
    const plain = Schema.Struct({ value: Schema.String });
    const schemas = [
      Schema.Struct({ value: Schema.Redacted(Schema.String) }),
      plain.pipe(
        Schema.middlewareEncoding<typeof plain, Encoding>((encoding) =>
          Encoding.pipe(Effect.flatMap(() => encoding))
        )
      ),
      plain.pipe(Schema.middlewareEncoding((encoding) => encoding)),
    ];
    for (const part of ["params", "query", "headers", "payload"] as const) {
      for (const schema of schemas) {
        const contract = HttpApi.make("unsafe").add(
          HttpApiGroup.make("requests").add(
            HttpApiEndpoint.post("save", "/:value", { [part]: schema })
          )
        );
        /* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
        expect(() =>
          createHttpApiQueryUtils(contract, {
            client: Effect.runSync(makeUnusedHttpClient(contract)),
            keyPrefix: ["test"],
          } as never)
        ).toThrow(expect.objectContaining({ code: "MissingKeyEncoder" }));
        /* oxlint-enable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
        let received: unknown;
        /* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
        const safe = createHttpApiQueryUtils(contract, {
          client: Effect.runSync(makeUnusedHttpClient(contract)),
          keyPrefix: ["test"],
          keyEncoders: {
            requests: {
              save: (request: unknown) => {
                received = request;
                return { identity: "public-id" };
              },
            },
          },
        } as never);
        /* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion */
        const input = { [part]: { value: Redacted.make("secret") } };
        /* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion */
        expect(
          (
            safe.requests.save.queryKey as (
              input: unknown
            ) => readonly unknown[]
          )(input).at(-1)
        ).toStrictEqual({ identity: "public-id" });
        /* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion */
        expect(received).toBe(input);
      }
    }
  });
});
