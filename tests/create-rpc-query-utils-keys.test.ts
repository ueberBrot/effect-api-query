import { describe, expect, it } from "@effect/vitest";
import { dehydrate, hydrate, QueryClient } from "@tanstack/query-core";
import { Effect, Predicate, Schema, SchemaTransformation } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import { createRpcQueryUtils, EffectRpcQueryKeyError } from "#effect-api-query";
import type { EffectRpcQueryConfigError, JsonValue } from "#effect-api-query";

import { group, makeClient, makeRpcTestClient } from "./fixtures/effect-rpc";

const captureKeyError = (
  run: () => readonly unknown[]
): EffectRpcQueryKeyError => {
  try {
    run();
  } catch (error) {
    if (error instanceof EffectRpcQueryKeyError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected key preparation to fail");
};

describe("createRpcQueryUtils semantic keys", () => {
  it.effect(
    "shares cache identity across generated options, key-only operations, and hydration",
    () =>
      Effect.gen(function* shareHydratedCacheIdentity() {
        const client = yield* makeClient();
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["app", { z: 2, a: [1] }],
        });
        const options = utils.users.get.queryOptions({ input: { id: 1 } });
        const queryClient = new QueryClient();
        const user = yield* Effect.promise(
          async () => await queryClient.query(options)
        );
        expect(queryClient.getQueryData(options.queryKey)).toStrictEqual(user);
        queryClient.setQueryData(options.queryKey, {
          ...user,
          name: "Updated",
        });
        expect(
          queryClient
            .getQueryCache()
            .find({ queryKey: options.queryKey, exact: true })?.state.data
        ).toStrictEqual({ ...user, name: "Updated" });
        expect(
          queryClient.getQueryCache().findAll({ queryKey: utils.key() })
        ).toHaveLength(1);
        const hydrated = new QueryClient();
        /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion, unicorn/prefer-structured-clone */
        hydrate(
          hydrated,
          JSON.parse(JSON.stringify(dehydrate(queryClient))) as ReturnType<
            typeof dehydrate
          >
        );
        /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion, unicorn/prefer-structured-clone */
        expect(hydrated.getQueryData(options.queryKey)).toStrictEqual({
          ...user,
          name: "Updated",
        });
      })
  );

  it.effect("owns a normalized, deeply frozen copy of the key prefix", () =>
    Effect.gen(function* freezeCanonicalKeyPrefix() {
      const mutableNamespace = {
        nested: { value: 1 },
        numbers: [-0],
      };
      const keyPrefix = ["app", mutableNamespace] as const;
      const client = yield* makeClient();
      const utils = createRpcQueryUtils(group, { client, keyPrefix });

      mutableNamespace.nested.value = 2;
      mutableNamespace.numbers[0] = 3;

      expect(utils.key()).toStrictEqual([
        "app",
        {
          nested: { value: 1 },
          numbers: [0],
        },
        "rpc",
      ]);
      expect(Object.is(utils.key()[1]?.numbers?.[0], -0)).toBe(false);
      expect({
        key: Object.isFrozen(utils.key()),
        namespace: Object.isFrozen(utils.key()[1]),
        nested: Object.isFrozen(utils.key()[1]?.nested),
        numbers: Object.isFrozen(utils.key()[1]?.numbers),
      }).toStrictEqual({
        key: true,
        namespace: true,
        nested: true,
        numbers: true,
      });
    })
  );

  it.effect(
    "builds flat prefix-matchable keys and omits variables from mutation keys",
    () =>
      Effect.gen(function* buildPrefixMatchableKeys() {
        const client = yield* makeClient();
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["tenant", 42] as const,
        });

        const queryKey = utils.users.get.queryKey({ id: 1 });

        expect({
          root: utils.key(),
          branch: utils.users.key(),
          leaf: utils.users.get.key(),
        }).toStrictEqual({
          root: queryKey.slice(0, 3),
          branch: queryKey.slice(0, 4),
          leaf: queryKey.slice(0, 5),
        });
        expect(queryKey.slice(0, 6)).toStrictEqual([
          "tenant",
          42,
          "rpc",
          "users",
          "get",
          "query",
        ]);
        expect(utils.users.get.mutationKey()).toStrictEqual([
          "tenant",
          42,
          "rpc",
          "users",
          "get",
          "mutation",
        ]);
        expect(utils.users.get.mutationOptions().mutationKey).toBe(
          utils.users.get.mutationKey()
        );
        expect(utils.health.ping.queryKey()).toStrictEqual([
          "tenant",
          42,
          "rpc",
          "health",
          "ping",
          "query",
        ]);
      })
  );

  it.effect(
    "builds distinct immutable infinite keys from normalized payloads",
    () =>
      Effect.gen(function* buildImmutableInfiniteKeys() {
        const client = yield* makeClient();
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["tenant", 42] as const,
        });

        const infiniteKey = utils.users.get.infiniteKey({ id: 1 });

        expect(infiniteKey).toStrictEqual([
          "tenant",
          42,
          "rpc",
          "users",
          "get",
          "infinite",
          { id: 1, locale: "en" },
        ]);
        expect(infiniteKey).toStrictEqual(
          utils.users.get.infiniteKey({ id: 1, locale: "en" })
        );
        for (const otherView of [
          utils.users.get.queryKey({ id: 1 }),
          utils.users.get.mutationKey(),
        ]) {
          expect(infiniteKey).not.toStrictEqual(otherView);
        }
        expect({
          key: Object.isFrozen(infiniteKey),
          payload: Object.isFrozen(infiniteKey.at(-1)),
        }).toStrictEqual({ key: true, payload: true });
        expect(utils.health.ping.infiniteKey()).toStrictEqual([
          "tenant",
          42,
          "rpc",
          "health",
          "ping",
          "infinite",
        ]);
      })
  );

  it.effect(
    "constructs and canonically encodes supported query-stable payload Schemas",
    () =>
      Effect.gen(function* encodeQueryStablePayloads() {
        class ClassPayload extends Schema.Class<
          ClassPayload,
          { readonly brand: unique symbol }
        >("ClassPayload")({
          id: Schema.Finite,
        }) {}

        const Struct = Rpc.make("shapes.struct", {
          payload: { id: Schema.Finite, name: Schema.String },
        });
        const Defaulted = Rpc.make("shapes.defaulted", {
          payload: {
            id: Schema.Finite,
            locale: Schema.String.pipe(
              Schema.optionalKey,
              Schema.withConstructorDefault(Effect.succeed("en"))
            ),
          },
        });
        const Transformed = Rpc.make("shapes.transformed", {
          payload: Schema.Struct({ id: Schema.FiniteFromString }),
        });
        const Class = Rpc.make("shapes.class", { payload: ClassPayload });
        const Void = Rpc.make("shapes.void");
        const payloadGroup = RpcGroup.make(
          Struct,
          Defaulted,
          Transformed,
          Class,
          Void
        );
        const client = yield* makeRpcTestClient(payloadGroup, {
          "shapes.class": () => Effect.void,
          "shapes.defaulted": () => Effect.void,
          "shapes.struct": () => Effect.void,
          "shapes.transformed": () => Effect.void,
          "shapes.void": () => Effect.void,
        });
        const utils = createRpcQueryUtils(payloadGroup, {
          client,
          keyPrefix: ["app"] as const,
        });

        expect(
          utils.shapes.struct.queryKey({ id: 1, name: "Ada" }).at(-1)
        ).toStrictEqual({
          id: 1,
          name: "Ada",
        });
        expect(utils.shapes.defaulted.queryKey({ id: 1 })).toStrictEqual(
          utils.shapes.defaulted.queryKey({ id: 1, locale: "en" })
        );
        expect(
          utils.shapes.transformed.queryKey({ id: 42 }).at(-1)
        ).toStrictEqual({ id: "42" });
        expect(utils.shapes.class.queryKey({ id: 1 }).at(-1)).toStrictEqual({
          id: 1,
        });
        expect(utils.shapes.void.queryKey()).toStrictEqual([
          "app",
          "rpc",
          "shapes",
          "void",
          "query",
        ]);
      })
  );

  it.effect(
    "sorts object keys and isolates canonical payloads from caller mutation",
    () =>
      Effect.gen(function* isolateCanonicalPayloads() {
        const Nested = Rpc.make("nested.read", {
          payload: {
            z: Schema.String,
            details: Schema.Struct({ z: Schema.Finite, a: Schema.Finite }),
            a: Schema.String,
          },
        });
        const nestedGroup = RpcGroup.make(Nested);
        const client = yield* makeRpcTestClient(nestedGroup, {
          "nested.read": () => Effect.void,
        });
        const utils = createRpcQueryUtils(nestedGroup, {
          client,
          keyPrefix: ["app"] as const,
        });
        const input = { z: "last", details: { z: 2, a: 1 }, a: "first" };

        const key = utils.nested.read.queryKey(input);
        input.details.a = 99;
        input.a = "changed";

        const canonical = key.at(-1);
        if (
          !Predicate.isObject(canonical) ||
          !Predicate.isObject(canonical["details"])
        ) {
          throw new TypeError("Expected canonical nested payload objects");
        }
        expect(Object.keys(canonical)).toStrictEqual(["a", "details", "z"]);
        expect(Object.keys(canonical["details"])).toStrictEqual(["a", "z"]);
        expect(canonical).toStrictEqual({
          a: "first",
          details: { a: 1, z: 2 },
          z: "last",
        });
        expect({
          key: Object.isFrozen(key),
          payload: Object.isFrozen(canonical),
          details: Object.isFrozen(canonical["details"]),
        }).toStrictEqual({ key: true, payload: true, details: true });
      })
  );

  it.effect(
    "rejects every non-JSON key value synchronously without executing an RPC",
    () =>
      Effect.gen(function* rejectNonJsonKeyValues() {
        let executions = 0;
        const Invalid = Rpc.make("invalid.read", {
          payload: Schema.Struct({ value: Schema.Unknown }),
        });
        const invalidGroup = RpcGroup.make(Invalid);
        const client = yield* makeRpcTestClient(invalidGroup, {
          "invalid.read": () => {
            executions += 1;
            return Effect.void;
          },
        });
        interface Cycle {
          self?: Cycle;
        }
        const cycle: Cycle = {};
        cycle.self = cycle;
        const sparse = ["removed", "present"];
        Reflect.deleteProperty(sparse, "0");
        const inheritedSparse = ["removed", "present"];
        Reflect.deleteProperty(inheritedSparse, "0");
        const inheritedArrayPrototype = { 0: "inherited" };
        Object.setPrototypeOf(inheritedArrayPrototype, Array.prototype);
        Object.setPrototypeOf(inheritedSparse, inheritedArrayPrototype);
        const invalidValues: readonly unknown[] = [
          undefined,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          1n,
          Symbol("invalid"),
          () => {},
          sparse,
          inheritedSparse,
          cycle,
          new Date(0),
          new Map(),
        ];
        const utils = createRpcQueryUtils(invalidGroup, {
          client,
          keyPrefix: ["app"] as const,
        });

        for (const invalidValue of invalidValues) {
          const error = captureKeyError(() =>
            utils.invalid.read.queryKey({ value: invalidValue })
          );
          expect(error).toMatchObject({
            _tag: "EffectRpcQueryKeyError",
            code: "InvalidKeyValue",
            rpcTag: "invalid.read",
          });
          expect(error.cause).toBeInstanceOf(TypeError);
          for (const property of ["encoded", "input", "payload", "value"]) {
            expect(error).not.toHaveProperty(property);
          }
        }
        expect(executions).toBe(0);
      })
  );

  it.effect(
    "classifies construction and encoding failures without retaining payload values",
    () =>
      Effect.gen(function* classifyPayloadKeyFailures() {
        const Construction = Rpc.make("errors.construction", {
          payload: { secret: Schema.Literal("expected") },
        });
        const encodingFailure = new Error("encoding failed");
        const FailingEncoding = Schema.String.pipe(
          Schema.decodeTo(
            Schema.String,
            SchemaTransformation.transform<string, string>({
              decode: (value) => value,
              encode: () => {
                throw encodingFailure;
              },
            })
          )
        );
        const Encoding = Rpc.make("errors.encoding", {
          payload: FailingEncoding,
        });
        const errors = RpcGroup.make(Construction, Encoding);
        const client = yield* makeRpcTestClient(errors, {
          "errors.construction": () => Effect.void,
          "errors.encoding": () => Effect.void,
        });
        const utils = createRpcQueryUtils(errors, {
          client,
          keyPrefix: ["app"] as const,
        });

        /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
        const construction = captureKeyError(() =>
          utils.errors.construction.queryKey({
            secret: "do-not-retain" as "expected",
          })
        );
        /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
        expect(construction).toMatchObject({
          code: "PayloadConstructionFailed",
          rpcTag: "errors.construction",
        });
        expect(construction.cause).toBeDefined();
        expect(construction.message).not.toContain("do-not-retain");
        for (const property of ["input", "payload"]) {
          expect(construction).not.toHaveProperty(property);
        }

        const encoding = captureKeyError(() =>
          utils.errors.encoding.queryKey("safe-value")
        );
        expect(encoding).toMatchObject({
          code: "PayloadEncodingFailed",
          rpcTag: "errors.encoding",
        });
        expect(encoding.cause).toBe(encodingFailure);
        for (const property of ["encoded", "payload"]) {
          expect(encoding).not.toHaveProperty(property);
        }
      })
  );

  it("rejects invalid runtime prefixes before returning a utility tree", () => {
    const invalidPrefixes: readonly unknown[] = [
      [],
      ["app", undefined],
      ["app", Number.NaN],
      ["app", new Date(0)],
    ];

    for (const keyPrefix of invalidPrefixes) {
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
      expect(() =>
        createRpcQueryUtils(group, {
          client: () => {
            throw new Error(
              "Invalid key prefixes must fail before RPC execution"
            );
          },
          keyPrefix: keyPrefix as readonly [JsonValue, ...JsonValue[]],
        })
      ).toThrow(
        expect.objectContaining<Partial<EffectRpcQueryConfigError>>({
          code: "InvalidKeyPrefix",
        })
      );
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    }
  });
});
