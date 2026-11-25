import { dehydrate, QueryClient } from "@tanstack/query-core";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Redacted,
  Schema,
  Scope,
} from "effect";
import {
  Headers,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServer,
  HttpServerRequest,
} from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from "effect/http-api";
import { describe, expect, it } from "vite-plus/test";

import { createHttpApiQueryUtils } from "#effect-api-query";
import type { JsonValue } from "#effect-api-query";

import { makeUnusedHttpClient } from "./fixtures/http-client";

const expectMissingEncoder = (build: () => void) => {
  expect(build).toThrow(expect.objectContaining({ code: "MissingKeyEncoder" }));
};

const api = HttpApi.make("keys").add(
  HttpApiGroup.make("requests").add(
    HttpApiEndpoint.post("save", "/save", {
      query: { filter: Schema.optional(Schema.String) },
      headers: Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String)),
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
  it("uses the same request parse options as the ready client", async () => {
    const query = { id: Schema.String.check(Schema.isMinLength(2)) };
    const contract = HttpApi.make("parse-options").add(
      HttpApiGroup.make("requests")
        .add(
          HttpApiEndpoint.get("strict", "/strict", {
            query,
            success: Schema.String,
          }),
          HttpApiEndpoint.get("relaxed", "/relaxed", {
            query,
            success: Schema.String,
          }).annotate(HttpApi.QueryParseOptions, { disableChecks: true })
        )
        .annotate(HttpApi.ParseOptions, { onExcessProperty: "error" })
    );
    const client = await Effect.runPromise(makeUnusedHttpClient(contract));
    const http = createHttpApiQueryUtils(contract, {
      client,
      keyPrefix: ["parse-options"],
    });
    const invalid = { query: { id: "valid", extra: true } };
    expect(() => http.requests.strict.queryKey({ input: invalid })).toThrow(
      "Could not encode the HTTP key"
    );
    expect(
      http.requests.relaxed.queryKey({ input: { query: { id: "x" } } }).at(-1)
    ).toStrictEqual({ query: { id: "x" } });
  });

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
          headers: Schema.Record(
            Schema.String,
            Schema.UndefinedOr(Schema.String)
          ),
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
        request: Parameters<typeof http.requests.read.queryKey>[0]["input"]
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
        key: http.text.queryKey({ input: { payload: 42 } }).at(-1),
        data: await queryClient.query(
          http.text.queryOptions({ input: { payload: 42 } })
        ),
      }).toStrictEqual({ key: { payload: "42" }, data: 42 });
      expect({
        key: http.form
          .queryKey({ input: { payload: { page: 2, filter: undefined } } })
          .at(-1),
        data: await queryClient.query(
          http.form.queryOptions({ input: { payload: { page: 2 } } })
        ),
      }).toStrictEqual({ key: { payload: { page: "2" } }, data: 2 });
      const search = { payload: { page: 3 }, query: { sort: "name" } };
      expect({
        key: http.search.queryKey({ input: search }).at(-1),
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
        defaults.binary.queryKey({ input: { payload: new Uint8Array([7]) } })
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
    const key = utils.requests.save.queryKey({ input });
    expect(key.at(-1)).toStrictEqual({
      query: {},
      headers: { "x-locale": "en" },
      payload: { nested: { kept: [2, 1] } },
    });
    expect(key).toStrictEqual(
      utils.requests.save.queryKey({
        input: {
          query: {},
          headers: { "x-locale": "en" },
          payload: { nested: { kept: [2, 1] } },
        },
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

  it("canonicalizes duplicate case-variant structured headers before collision detection", () => {
    const contract = HttpApi.make("structured-headers").add(
      HttpApiGroup.make("requests").add(
        HttpApiEndpoint.get("read", "/read", {
          headers: Schema.Record(Schema.String, Schema.Unknown),
        })
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client: Effect.runSync(makeUnusedHttpClient(contract)),
      keyPrefix: ["test"],
    });

    const reorderedKey = http.requests.read.queryKey({
      input: {
        headers: {
          "X-Meta": { second: { b: "2", a: "1" }, first: "ok" },
          "x-meta": { first: "ok", second: { a: "1", b: "2" } },
        },
      },
    });
    const canonicalKey = http.requests.read.queryKey({
      input: {
        headers: {
          "x-meta": { first: "ok", second: { a: "1", b: "2" } },
        },
      },
    });

    expect(reorderedKey).toStrictEqual(canonicalKey);
    expect(reorderedKey.at(-1)).toStrictEqual({
      headers: {
        "x-meta": { first: "ok", second: { a: "1", b: "2" } },
      },
    });

    expect(() =>
      http.requests.read.queryOptions({
        input: {
          headers: {
            "X-Meta": { second: { b: "2", a: "1" }, first: "ok" },
            "x-meta": { first: "ok", second: { a: "1", b: "3" } },
          },
        },
      })
    ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));

    const sparse: string[] = [];
    sparse[1] = "a";
    expect(() =>
      http.requests.read.queryOptions({
        input: {
          headers: {
            "X-Meta": sparse,
            "x-meta": sparse,
          },
        },
      })
    ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));

    expect(() =>
      http.requests.read.queryOptions({
        input: {
          headers: {
            "X-Meta": { constructor: "bad" },
            "x-meta": { constructor: "bad" },
          },
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
    const key = http.requests.read.queryKey({ input });

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
      http.search.find
        .queryKey({ input: { query: { values: ["b", "a"] } } })
        .at(-1)
    ).toStrictEqual({
      query: { values: ["b", "a"] },
    });
    expect(
      http.search.find.queryKey({ input: { query: { values: ["b", "a"] } } })
    ).not.toStrictEqual(
      http.search.find.queryKey({ input: { query: { values: ["a", "b"] } } })
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

    expect(() =>
      http.requests.read.queryKey({ input: { payload: values } })
    ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));
    expect(() =>
      http.requests.read.queryOptions({ input: { payload: values } })
    ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));
  });

  it("keeps custom encoder output strict, copied, and deeply frozen", () => {
    const input = { query: {}, headers: {}, payload: null };
    const value = { nested: { values: [2, 1] } };
    const key = encodeTestKey(() => value).requests.save.queryKey({ input });
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
    expect(
      custom["save.one"].queryKey({ input: { payload: 1 } }).at(-1)
    ).toStrictEqual({
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
      expect(
        http.forms.submit.queryKey({ input: { payload: 1 } })
      ).not.toStrictEqual(
        http.forms.submit.queryKey({ input: { payload: "1" } })
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
            safe.requests.save.queryKey as (options: {
              readonly input: unknown;
            }) => readonly unknown[]
          )({ input }).at(-1)
        ).toStrictEqual({ identity: "public-id" });
        /* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion */
        expect(received).toBe(input);
      }
    }
  });

  it("requires custom key encoders for fields annotated with HttpApi.RedactedNames across API, group, and endpoint levels", async () => {
    const apiHeaderOnly = HttpApi.make("api-header-only")
      .annotate(HttpApi.RedactedNames, { headers: ["x-api-token"] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("read", "/read", {
            headers: { "X-Api-Token": Schema.String },
          })
        )
      );
    const groupQueryOnly = HttpApi.make("group-query-only").add(
      HttpApiGroup.make("g")
        .annotate(HttpApi.RedactedNames, { query: ["buildargs"] })
        .add(
          HttpApiEndpoint.get("read", "/read", {
            query: {
              buildargs: Schema.Struct({ NPM_TOKEN: Schema.String }),
            },
          })
        )
    );
    const endpointRegexOnly = HttpApi.make("endpoint-regex-only").add(
      HttpApiGroup.make("g").add(
        HttpApiEndpoint.get("read", "/read", {
          query: { nested: Schema.Struct({ secret_key: Schema.String }) },
        }).annotate(HttpApi.RedactedNames, { query: [/secret/iu] })
      )
    );
    const combinedLayers = HttpApi.make("combined-layers")
      .annotate(HttpApi.RedactedNames, { headers: ["x-api-token"] })
      .add(
        HttpApiGroup.make("g")
          .annotate(HttpApi.RedactedNames, { query: ["other"] })
          .add(
            HttpApiEndpoint.get("read", "/read", {
              headers: { "x-api-token": Schema.String },
            })
          )
      );
    const getPayloadRedacted = HttpApi.make("get-payload-redacted")
      .annotate(HttpApi.RedactedNames, { query: ["token"] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("read", "/read", {
            payload: { token: Schema.String },
          })
        )
      );
    const openRecordRedacted = HttpApi.make("open-record-redacted")
      .annotate(HttpApi.RedactedNames, { headers: ["x-api-token"] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("read", "/read", {
            headers: Schema.Record(Schema.String, Schema.String),
          })
        )
      );

    expectMissingEncoder(() => {
      createHttpApiQueryUtils(apiHeaderOnly, {
        client: Effect.runSync(makeUnusedHttpClient(apiHeaderOnly)),
        keyPrefix: ["test"],
      });
    });
    expectMissingEncoder(() => {
      createHttpApiQueryUtils(groupQueryOnly, {
        client: Effect.runSync(makeUnusedHttpClient(groupQueryOnly)),
        keyPrefix: ["test"],
      });
    });
    expectMissingEncoder(() => {
      createHttpApiQueryUtils(endpointRegexOnly, {
        client: Effect.runSync(makeUnusedHttpClient(endpointRegexOnly)),
        keyPrefix: ["test"],
      });
    });
    expectMissingEncoder(() => {
      createHttpApiQueryUtils(combinedLayers, {
        client: Effect.runSync(makeUnusedHttpClient(combinedLayers)),
        keyPrefix: ["test"],
      });
    });
    expectMissingEncoder(() => {
      createHttpApiQueryUtils(getPayloadRedacted, {
        client: Effect.runSync(makeUnusedHttpClient(getPayloadRedacted)),
        keyPrefix: ["test"],
      });
    });
    expectMissingEncoder(() => {
      createHttpApiQueryUtils(openRecordRedacted, {
        client: Effect.runSync(makeUnusedHttpClient(openRecordRedacted)),
        keyPrefix: ["test"],
      });
    });

    const apiContract = HttpApi.make("redacted-names")
      .annotate(HttpApi.RedactedNames, {
        headers: ["x-api-token"],
        query: ["token"],
      })
      .add(
        HttpApiGroup.make("scoped")
          .annotate(HttpApi.RedactedNames, {
            headers: [/^x-group-secret-/iu],
            query: ["buildargs"],
          })
          .add(
            HttpApiEndpoint.get("publicList", "/public", {
              query: { page: Schema.FiniteFromString },
              success: Schema.String,
            }),
            HttpApiEndpoint.get("apiHeader", "/api-header", {
              headers: { "x-api-token": Schema.String, locale: Schema.String },
              success: Schema.String,
            }),
            HttpApiEndpoint.get("groupQuery", "/group-query", {
              query: { token: Schema.String, tag: Schema.String },
              success: Schema.String,
            }),
            HttpApiEndpoint.get("endpointQuery", "/endpoint-query", {
              query: { secret_key: Schema.String },
              success: Schema.String,
            }).annotate(HttpApi.RedactedNames, { query: [/secret/iu] }),
            HttpApiEndpoint.get("getPayload", "/get-payload", {
              payload: { token: Schema.String, label: Schema.String },
              success: Schema.String,
            }),
            HttpApiEndpoint.get("dynamicHeaders", "/dynamic-headers", {
              headers: Schema.Record(Schema.String, Schema.String),
              success: Schema.String,
            })
          )
      );

    let receivedHeaderSecret: string | undefined;
    let receivedQuerySecret: string | undefined;
    const handlers = HttpApiBuilder.group(apiContract, "scoped", (group) =>
      group
        .handle("publicList", ({ query }) =>
          Effect.succeed(`page:${query.page}`)
        )
        .handle("apiHeader", ({ headers }) => {
          receivedHeaderSecret = headers["x-api-token"];
          return Effect.succeed(`${headers.locale}:ok`);
        })
        .handle("groupQuery", ({ query }) => {
          receivedQuerySecret = query.token;
          return Effect.succeed(`${query.tag}:ok`);
        })
        .handle("endpointQuery", ({ query }) =>
          Effect.succeed(query.secret_key)
        )
        .handle("getPayload", ({ payload }) =>
          Effect.succeed(`${payload.label}:${payload.token}`)
        )
        .handle("dynamicHeaders", ({ headers }) =>
          Effect.succeed(headers["x-group-secret-key"] ?? "none")
        )
    );
    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      HttpApiTest.groups(apiContract, ["scoped"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope)
      )
    );
    let receivedTransportSecret: string | undefined;
    const transportApi = HttpApi.make("transport-auth")
      .annotate(HttpApi.RedactedNames, { headers: ["x-api-token"] })
      .add(
        HttpApiGroup.make("scoped").add(
          HttpApiEndpoint.get("publicList", "/public", {
            query: { page: Schema.FiniteFromString },
            success: Schema.String,
          })
        )
      );
    const transportClient = await Effect.runPromise(
      HttpApiClient.makeWith(transportApi, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.sync(() => {
            receivedTransportSecret = request.headers["x-api-token"];
            return HttpClientResponse.fromWeb(request, Response.json("page:2"));
          })
        ).pipe(
          HttpClient.mapRequest((request) =>
            HttpClientRequest.setHeader(
              request,
              "x-api-token",
              "transport-injected-secret"
            )
          )
        ),
      })
    );
    const transportHttp = createHttpApiQueryUtils(transportApi, {
      client: transportClient,
      keyPrefix: ["transport"],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    try {
      const http = createHttpApiQueryUtils(apiContract, {
        client,
        keyPrefix: ["redacted"],
        keyEncoders: {
          scoped: {
            apiHeader: ({ headers }) => ({ locale: headers.locale }),
            groupQuery: ({ query }) => ({ tag: query.tag }),
            endpointQuery: () => ({ scope: "redacted" }),
            getPayload: ({ payload }) => ({ label: payload.label }),
            dynamicHeaders: () => ({ scope: "dynamic" }),
          },
        },
      });

      const publicResult = await queryClient.query(
        http.scoped.publicList.queryOptions({ input: { query: { page: 2 } } })
      );
      await queryClient.query(
        transportHttp.scoped.publicList.queryOptions({
          input: { query: { page: 2 } },
        })
      );
      const headerResult = await queryClient.query(
        http.scoped.apiHeader.queryOptions({
          input: {
            headers: { "x-api-token": "super-secret-header", locale: "en" },
          },
        })
      );
      const queryResult = await queryClient.query(
        http.scoped.groupQuery.queryOptions({
          input: {
            query: { token: "super-secret-query", tag: "v1" },
          },
        })
      );

      const snapshotJson = JSON.stringify(dehydrate(queryClient));
      expect({
        publicResult,
        headerResult,
        queryResult,
        receivedHeaderSecret,
        receivedQuerySecret,
        receivedTransportSecret,
        leakedHeader: snapshotJson.includes("super-secret-header"),
        leakedQuery: snapshotJson.includes("super-secret-query"),
        leakedTransport: snapshotJson.includes("transport-injected-secret"),
      }).toStrictEqual({
        publicResult: "page:2",
        headerResult: "en:ok",
        queryResult: "v1:ok",
        receivedHeaderSecret: "super-secret-header",
        receivedQuerySecret: "super-secret-query",
        receivedTransportSecret: "transport-injected-secret",
        leakedHeader: false,
        leakedQuery: false,
        leakedTransport: false,
      });
    } finally {
      queryClient.clear();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("rejects case-sensitive header regexes, tuple-array queries, USVString-normalized names, encoded keys, addHttpApi, and streaming endpoints", () => {
    const caseSensitiveHeader = HttpApi.make("case-sensitive-header")
      .annotate(HttpApi.RedactedNames, { headers: [/^x-token$/u] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("read", "/read", {
            headers: { "X-Token": Schema.String },
          })
        )
      );
    const tupleArrayQuery = HttpApi.make("tuple-array-query")
      .annotate(HttpApi.RedactedNames, { query: ["token"] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("read", "/read", {
            query: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
          })
        )
      );
    const loneSurrogateQuery = HttpApi.make("lone-surrogate-query")
      .annotate(HttpApi.RedactedNames, { query: ["\uFFFD"] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("read", "/read", {
            query: { "\uD800": Schema.String },
          })
        )
      );
    const suspendedRenamed = Schema.suspend(() =>
      Schema.Union([
        Schema.Struct({ publicField: Schema.String }),
        Schema.Struct({ authToken: Schema.String }).pipe(
          Schema.encodeKeys({ authToken: "token" })
        ),
      ])
    );
    const encodedKeysUnion = HttpApi.make("encoded-keys-union")
      .annotate(HttpApi.RedactedNames, { query: ["token"] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("read", "/read", {
            query: suspendedRenamed,
          })
        )
      );
    const importedSubApi = HttpApi.make("imported")
      .annotate(HttpApi.RedactedNames, { headers: ["x-imported-secret"] })
      .add(
        HttpApiGroup.make("sub").add(
          HttpApiEndpoint.get("read", "/read", {
            headers: { "x-imported-secret": Schema.String },
          })
        )
      );
    const parentApi = HttpApi.make("parent").addHttpApi(importedSubApi);
    const streamingRedacted = HttpApi.make("streaming-redacted")
      .annotate(HttpApi.RedactedNames, { query: ["token"] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("watch", "/watch", {
            query: { token: Schema.String },
            success: HttpApiSchema.StreamSse({ data: Schema.String }),
          })
        )
      );

    const builders: (() => void)[] = [
      () => {
        createHttpApiQueryUtils(caseSensitiveHeader, {
          client: Effect.runSync(makeUnusedHttpClient(caseSensitiveHeader)),
          keyPrefix: ["test"],
        });
      },
      () => {
        createHttpApiQueryUtils(tupleArrayQuery, {
          client: Effect.runSync(makeUnusedHttpClient(tupleArrayQuery)),
          keyPrefix: ["test"],
        });
      },
      () => {
        createHttpApiQueryUtils(loneSurrogateQuery, {
          client: Effect.runSync(makeUnusedHttpClient(loneSurrogateQuery)),
          keyPrefix: ["test"],
        });
      },
      () => {
        createHttpApiQueryUtils(encodedKeysUnion, {
          client: Effect.runSync(makeUnusedHttpClient(encodedKeysUnion)),
          keyPrefix: ["test"],
        });
      },
      () => {
        createHttpApiQueryUtils(parentApi, {
          client: Effect.runSync(makeUnusedHttpClient(parentApi)),
          keyPrefix: ["test"],
        });
      },
      () => {
        createHttpApiQueryUtils(streamingRedacted, {
          client: Effect.runSync(makeUnusedHttpClient(streamingRedacted)),
          keyPrefix: ["test"],
        });
      },
    ];
    for (const build of builders) {
      expect(build).toThrow(
        expect.objectContaining({ code: "MissingKeyEncoder" })
      );
    }

    const unredactedNested = HttpApi.make("unredacted-nested-query")
      .annotate(HttpApi.RedactedNames, { query: [/^filter$/u] })
      .add(
        HttpApiGroup.make("g").add(
          HttpApiEndpoint.get("read", "/read", {
            query: { filter: Schema.Struct({ id: Schema.String }) },
          })
        )
      );
    const unredactedUtils = createHttpApiQueryUtils(unredactedNested, {
      client: Effect.runSync(makeUnusedHttpClient(unredactedNested)),
      keyPrefix: ["test"],
    });
    expect(
      unredactedUtils.g.read
        .queryKey({ input: { query: { filter: { id: "1" } } } })
        .at(-1)
    ).toStrictEqual({
      query: { filter: { id: "1" } },
    });
  });

  it("preserves repeated wire-parameter ordering for colliding URL-encoded request parts", async () => {
    const wireValue = Schema.Union([
      Schema.String,
      Schema.Array(Schema.String),
      Schema.Record(
        Schema.String,
        Schema.Union([
          Schema.String,
          Schema.Array(Schema.String),
          Schema.Record(Schema.String, Schema.String),
        ])
      ),
    ]);
    const dynamicRecord = Schema.Record(Schema.String, wireValue);
    const contract = HttpApi.make("wire-order").add(
      HttpApiGroup.make("search", { topLevel: true }).add(
        HttpApiEndpoint.get("query", "/query", {
          query: dynamicRecord,
          success: Schema.String,
        }),
        HttpApiEndpoint.get("getPayload", "/get-payload", {
          payload: { filter: Schema.optional(dynamicRecord) },
          success: Schema.String,
        }),
        HttpApiEndpoint.post("formPayload", "/form-payload", {
          payload: dynamicRecord.pipe(HttpApiSchema.asFormUrlEncoded()),
          success: Schema.String,
        }),
        HttpApiEndpoint.get("fixed", "/fixed", {
          query: { first: Schema.String, second: Schema.String },
          success: Schema.String,
        }),
        HttpApiEndpoint.get("payloadAndQuery", "/payload-and-query", {
          payload: {
            tag: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
          },
          query: {
            tag: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
          },
          success: Schema.String,
        })
      )
    );

    let queryCalls = 0;
    const handlers = HttpApiBuilder.group(contract, "search", (group) =>
      group
        .handle("query", () =>
          Effect.gen(function* readRawQuery() {
            queryCalls += 1;
            const request = yield* HttpServerRequest.HttpServerRequest;
            return request.url;
          })
        )
        .handle("getPayload", () =>
          Effect.gen(function* readRawGetPayload() {
            const request = yield* HttpServerRequest.HttpServerRequest;
            return request.url;
          })
        )
        .handle("formPayload", () =>
          Effect.gen(function* readRawFormPayload() {
            const request = yield* HttpServerRequest.HttpServerRequest;
            return yield* Effect.orDie(request.text);
          })
        )
        .handle("fixed", ({ query }) =>
          Effect.succeed(`${query.first}:${query.second}`)
        )
        .handle("payloadAndQuery", () =>
          Effect.gen(function* readCombinedUrl() {
            const request = yield* HttpServerRequest.HttpServerRequest;
            return request.url;
          })
        )
    );
    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      HttpApiTest.groups(contract, ["search"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope)
      )
    );
    const http = createHttpApiQueryUtils(contract, {
      client,
      keyPrefix: ["wire-order"],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    try {
      const literalFirst = { "a[b]": "1", a: { b: "2" } };
      const nestedFirst = { a: { b: "2" }, "a[b]": "1" };
      const surrogateFirst = { "\uD800": "A", "\uD801": "B" };
      const surrogateSecond = { "\uD801": "B", "\uD800": "A" };

      expect({
        reorderedDistinct:
          JSON.stringify(
            http.query.queryKey({ input: { query: literalFirst } })
          ) !==
          JSON.stringify(
            http.query.queryKey({ input: { query: nestedFirst } })
          ),
        surrogateDistinct:
          JSON.stringify(
            http.query.queryKey({ input: { query: surrogateFirst } })
          ) !==
          JSON.stringify(
            http.query.queryKey({ input: { query: surrogateSecond } })
          ),
        nestedDistinct:
          JSON.stringify(
            http.query.queryKey({
              input: { query: { x: { "a][b": "1", a: { b: "2" } } } },
            })
          ) !==
          JSON.stringify(
            http.query.queryKey({
              input: { query: { x: { a: { b: "2" }, "a][b": "1" } } },
            })
          ),
        arrayDistinct:
          JSON.stringify(
            http.query.queryKey({
              input: { query: { "a[b]": "1", a: { b: ["2", "3"] } } },
            })
          ) !==
          JSON.stringify(
            http.query.queryKey({
              input: { query: { a: { b: ["2", "3"] }, "a[b]": "1" } },
            })
          ),
        unrelatedKeyReused:
          JSON.stringify(
            http.query.queryKey({
              input: { query: { c: "3", "a[b]": "1", a: { b: "2" } } },
            })
          ) ===
          JSON.stringify(
            http.query.queryKey({
              input: { query: { "a[b]": "1", a: { b: "2" }, c: "3" } },
            })
          ),
      }).toStrictEqual({
        reorderedDistinct: true,
        surrogateDistinct: true,
        nestedDistinct: true,
        arrayDistinct: true,
        unrelatedKeyReused: true,
      });

      const [
        firstUrl,
        secondUrl,
        surrogateFirstUrl,
        surrogateSecondUrl,
        getPayloadFirst,
        getPayloadSecond,
        formFirst,
        formSecond,
        payloadAndQueryFirst,
        payloadAndQuerySecond,
      ] = await Promise.all([
        queryClient.query(
          http.query.queryOptions({ input: { query: literalFirst } })
        ),
        queryClient.query(
          http.query.queryOptions({ input: { query: nestedFirst } })
        ),
        queryClient.query(
          http.query.queryOptions({ input: { query: surrogateFirst } })
        ),
        queryClient.query(
          http.query.queryOptions({ input: { query: surrogateSecond } })
        ),
        queryClient.query(
          http.getPayload.queryOptions({
            input: { payload: { filter: { "b][c": "1", b: { c: "2" } } } },
          })
        ),
        queryClient.query(
          http.getPayload.queryOptions({
            input: { payload: { filter: { b: { c: "2" }, "b][c": "1" } } },
          })
        ),
        queryClient.query(
          http.formPayload.queryOptions({ input: { payload: literalFirst } })
        ),
        queryClient.query(
          http.formPayload.queryOptions({ input: { payload: nestedFirst } })
        ),
        queryClient.query(
          http.payloadAndQuery.queryOptions({
            input: { payload: { tag: "1" }, query: { tag: "2" } },
          })
        ),
        queryClient.query(
          http.payloadAndQuery.queryOptions({
            input: { payload: { tag: "2" }, query: { tag: "1" } },
          })
        ),
      ]);

      expect({
        firstUrl,
        secondUrl,
        surrogateFirstUrl,
        surrogateSecondUrl,
        queryCalls,
        getPayloadFirst,
        getPayloadSecond,
        formFirst,
        formSecond,
        payloadAndQueryFirst,
        payloadAndQuerySecond,
        fixedKey: http.fixed
          .queryKey({ input: { query: { second: "2", first: "1" } } })
          .at(-1),
      }).toStrictEqual({
        firstUrl: "/query?a%5Bb%5D=1&a%5Bb%5D=2",
        secondUrl: "/query?a%5Bb%5D=2&a%5Bb%5D=1",
        surrogateFirstUrl: "/query?%EF%BF%BD=A&%EF%BF%BD=B",
        surrogateSecondUrl: "/query?%EF%BF%BD=B&%EF%BF%BD=A",
        queryCalls: 4,
        getPayloadFirst:
          "/get-payload?filter%5Bb%5D%5Bc%5D=1&filter%5Bb%5D%5Bc%5D=2",
        getPayloadSecond:
          "/get-payload?filter%5Bb%5D%5Bc%5D=2&filter%5Bb%5D%5Bc%5D=1",
        formFirst: "a%5Bb%5D=1&a%5Bb%5D=2",
        formSecond: "a%5Bb%5D=2&a%5Bb%5D=1",
        payloadAndQueryFirst: "/payload-and-query?tag=1&tag=2",
        payloadAndQuerySecond: "/payload-and-query?tag=2&tag=1",
        fixedKey: { query: { first: "1", second: "2" } },
      });
    } finally {
      queryClient.clear();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("normalizes Headers.fromInput, custom-prototype header bags, and OptionFromOptionalKey query schemas", () => {
    const headerBagProto = {};
    const makeHeaderBag = (
      token: string,
      extra?: string,
      includeExtra = false
    ): Record<string, string | undefined> => {
      // oxlint-disable-next-line typescript/no-unsafe-assignment
      const bag: Record<string, string | undefined> =
        Object.create(headerBagProto);
      bag["X-Token"] = token;
      if (includeExtra) {
        bag["X-Extra"] = extra;
      }
      return bag;
    };
    const HeaderBagSchema = Schema.declare(
      (value): value is Record<string, string | undefined> =>
        Predicate.isObject(value) &&
        Object.getPrototypeOf(value) === headerBagProto
    );

    const regressionApi = HttpApi.make("header-and-optional-key").add(
      HttpApiGroup.make("items", { topLevel: true })
        .add(
          HttpApiEndpoint.get("effectHeaders", "/effect-headers", {
            headers: Schema.declare(Headers.isHeaders),
            disableCodecs: true,
            success: Schema.String,
          })
        )
        .add(
          HttpApiEndpoint.get("classHeaders", "/class-headers", {
            headers: HeaderBagSchema,
            disableCodecs: true,
            success: Schema.String,
          })
        )
        .add(
          HttpApiEndpoint.get("optionalQuery", "/optional-query", {
            query: Schema.OptionFromOptionalKey(
              Schema.Struct({ page: Schema.Int })
            ),
            success: Schema.String,
          })
        )
    );
    const regressionUtils = createHttpApiQueryUtils(regressionApi, {
      client: Effect.runSync(makeUnusedHttpClient(regressionApi)),
      keyPrefix: ["regression"],
    });

    // oxlint-disable-next-line typescript/no-unsafe-assignment
    const inheritedQueryInput: {
      readonly query: Option.Option<{ readonly page: number }>;
    } = Object.create({ query: Option.some({ page: 2 }) });

    expect({
      effectHeaders: regressionUtils.effectHeaders
        .queryKey({
          input: { headers: Headers.fromInput({ "X-Token": "public" }) },
        })
        .at(-1),
      classHeaders: regressionUtils.classHeaders
        .queryKey({
          input: { headers: makeHeaderBag("public") },
        })
        .at(-1),
      optionalNone: regressionUtils.optionalQuery
        .queryKey({
          input: { query: Option.none() },
        })
        .at(-1),
      optionalSome: regressionUtils.optionalQuery
        .queryKey({
          input: { query: Option.some({ page: 2 }) },
        })
        .at(-1),
      inheritedQuery: regressionUtils.optionalQuery.queryKey({
        input: inheritedQueryInput,
      }),
    }).toStrictEqual({
      effectHeaders: { headers: { "x-token": "public" } },
      classHeaders: { headers: { "x-token": "public" } },
      optionalNone: {},
      optionalSome: { query: { page: "2" } },
      inheritedQuery: regressionUtils.optionalQuery.queryKey({
        input: { query: Option.some({ page: 2 }) },
      }),
    });

    expect(() =>
      regressionUtils.classHeaders.queryKey({
        input: { headers: makeHeaderBag("public", undefined, true) },
      })
    ).toThrow(expect.objectContaining({ code: "InvalidKeyValue" }));
  });
});
