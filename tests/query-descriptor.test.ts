import { it } from "@effect/vitest";
import {
  dehydrate,
  hydrate,
  QueryClient,
  QueryObserver,
} from "@tanstack/query-core";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { Effect, Schema, SchemaTransformation, Stream } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect } from "vite-plus/test";

import {
  createHttpApiQueryUtils,
  createQueryDescriptor,
  QueryDescriptorError,
  createRpcQueryUtils,
  fetchStreamSnapshot,
} from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";
import { makeUnusedHttpClient } from "./fixtures/http-client";

it.effect("reuses a loader selection across independent hydrated owners", () =>
  Effect.gen(function* hydrateIndependentOwners() {
    const input = Schema.Struct({ id: Schema.Int });
    const group = RpcGroup.make(
      Rpc.make("read", { payload: input, success: Schema.Int })
    );
    let browserFetches = 0;
    const serverClient = yield* makeRpcTestClient(group, {
      read: ({ id }) => Effect.succeed(id),
    });
    const browserClient = yield* makeRpcTestClient(group, {
      read: ({ id }) => {
        browserFetches += 1;
        return Effect.succeed(id);
      },
    });
    const server = createRpcQueryUtils(group, {
      client: serverClient,
      keyPrefix: ["loader"],
    });
    const browser = createRpcQueryUtils(group, {
      client: browserClient,
      keyPrefix: ["loader"],
    });
    const loader = createQueryDescriptor(server.read, "query", {
      contract: "users-v1",
      input,
    });
    const component = createQueryDescriptor(browser.read, "query", {
      contract: "users-v1",
      input,
    });
    const selection = { id: 7 };
    const descriptor = loader.capture(selection);
    selection.id = 99;
    const serverCache = new QueryClient();
    const browserCache = new QueryClient();
    try {
      const bound = loader.bind(descriptor);
      yield* Effect.promise(
        async () =>
          await serverCache.query(
            bound.leaf.queryOptions({ input: bound.input, staleTime: Infinity })
          )
      );
      const wire = JSON.stringify({
        descriptor,
        state: dehydrate(serverCache),
      });
      // SAFETY: this snapshot is produced immediately above by native dehydrate in the same test.
      // oxlint-disable-next-line typescript/no-unsafe-assignment
      const transferred: {
        readonly descriptor: unknown;
        readonly state: ReturnType<typeof dehydrate>;
      } = JSON.parse(wire);
      hydrate(browserCache, transferred.state);
      const received = component.bind(transferred.descriptor);
      const value = yield* Effect.promise(
        async () =>
          await browserCache.query(
            received.leaf.queryOptions({
              input: received.input,
              staleTime: Infinity,
            })
          )
      );
      expect(value).toBe(7);
      const Component = () => {
        const { data } = useSuspenseQuery(
          received.leaf.queryOptions({
            input: received.input,
            staleTime: Infinity,
          })
        );
        return createElement("span", null, data);
      };
      expect(
        renderToString(
          createElement(
            QueryClientProvider,
            { client: browserCache },
            createElement(Component)
          )
        )
      ).toBe("<span>7</span>");
      expect(browserFetches).toBe(0);
      expect(
        yield* Effect.promise(
          async () =>
            await browserCache.query(
              browser.read.queryOptions({ input: selection })
            )
        )
      ).toBe(99);
      expect(browserFetches).toBe(1);
    } finally {
      serverCache.clear();
      browserCache.clear();
    }
  })
);

it.effect(
  "rejects malformed selections and incompatible contracts, views, owners and identities",
  () =>
    Effect.gen(function* rejectIncompatibleSelections() {
      const input = Schema.Struct({ id: Schema.Int });
      const group = RpcGroup.make(
        Rpc.make("read", { payload: input, success: Schema.Int })
      );
      const client = yield* makeRpcTestClient(group, {
        read: ({ id }) => Effect.succeed(id),
      });
      const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["one"] });
      const other = createRpcQueryUtils(group, { client, keyPrefix: ["two"] });
      const registration = createQueryDescriptor(rpc.read, "query", {
        contract: "v1",
        input,
      });
      const descriptor = registration.capture({ id: 7 });
      const lossy = input.pipe(
        Schema.decodeTo(
          input,
          SchemaTransformation.transform({
            decode: (value) => value,
            encode: (value) => ({ id: value.id + 1 }),
          })
        )
      );
      expect(() =>
        createQueryDescriptor(rpc.read, "query", {
          contract: "v1",
          input: lossy,
        }).capture({ id: 7 })
      ).toThrow("Identity");
      const incompatibleEncoder = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["one"],
        keyEncoders: { read: () => "different" },
      });
      expect(() =>
        createQueryDescriptor(incompatibleEncoder.read, "query", {
          contract: "v1",
          input,
        }).bind(descriptor)
      ).toThrow("Identity");
      for (const value of [
        null,
        {},
        { ...descriptor, version: 2 },
        { ...descriptor, data: "secret" },
        { ...descriptor, input: () => 7 },
      ]) {
        expect(() => registration.bind(value)).toThrow(
          new QueryDescriptorError("Malformed")
        );
      }
      for (const value of [
        { ...descriptor, contract: "v2" },
        { ...descriptor, view: "metadata" },
      ]) {
        expect(() => registration.bind(value)).toThrow("Incompatible");
      }
      expect(() =>
        createQueryDescriptor(other.read, "query", {
          contract: "v1",
          input,
        }).bind(descriptor)
      ).toThrow("Incompatible");
      expect(() =>
        registration.bind({ ...descriptor, input: { id: "wrong" } })
      ).toThrow("Input");
      expect(() =>
        registration.bind({ ...descriptor, input: { id: 8 } })
      ).toThrow("Identity");
    })
);

it.effect("transfers rich decoded input with an explicit codec", () =>
  Effect.gen(function* transferRichInput() {
    const input = Schema.Struct({ id: Schema.BigIntFromString });
    const group = RpcGroup.make(
      Rpc.make("read", { payload: input, success: Schema.String })
    );
    const client = yield* makeRpcTestClient(group, {
      read: ({ id }) => Effect.succeed(String(id)),
    });
    const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["rich"] });
    const registration = createQueryDescriptor(rpc.read, "query", {
      contract: "v1",
      input,
    });
    const descriptor = registration.capture({ id: 23n });
    expect(descriptor.input).toStrictEqual({ id: "23" });
    const wire = JSON.stringify(descriptor);
    const bound = registration.bind(JSON.parse(wire));
    const cache = new QueryClient();
    try {
      expect(
        yield* Effect.promise(
          async () =>
            await cache.query(bound.leaf.queryOptions({ input: bound.input }))
        )
      ).toBe("23");
      expect(bound.leaf.queryKey(bound.input)).toStrictEqual(
        rpc.read.queryKey({ id: 23n })
      );
    } finally {
      cache.clear();
    }
  })
);

it.effect(
  "keeps inputless live descriptors on native exclusive snapshot capture",
  () =>
    Effect.gen(function* captureExclusiveDescriptorSnapshot() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const client = yield* makeRpcTestClient(group, {
        watch: () => Stream.make(1, 2),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["snapshot-descriptor"],
      });
      const input = Schema.Null.pipe(
        Schema.decodeTo(
          Schema.Void,
          SchemaTransformation.transform({
            decode: () => {},
            encode: () => null,
          })
        )
      );
      const registration = createQueryDescriptor(rpc.watch, "live", {
        contract: "v1",
        input,
      });
      const bound = registration.bind(registration.capture());
      const options = bound.leaf.liveOptions({ staleTime: Infinity });
      const cache = new QueryClient();
      const observer = new QueryObserver(cache, { ...options, enabled: false });
      const unsubscribe = observer.subscribe(() => {});
      try {
        yield* Effect.promise(async () => {
          await expect(fetchStreamSnapshot(cache, options)).rejects.toThrow(
            "idle query without observers"
          );
        });
        unsubscribe();
        expect(
          yield* Effect.promise(
            async () => await fetchStreamSnapshot(cache, options)
          )
        ).toBe(1);
        expect(bound.prefix).toStrictEqual([...rpc.watch.key(), "live"]);
      } finally {
        unsubscribe();
        observer.destroy();
        cache.clear();
      }
    })
);

it.effect(
  "rebinds HTTP decoded request input with metadata and adapter key prefixes",
  () =>
    Effect.gen(function* rebindHttpDescriptor() {
      const api = HttpApi.make("descriptor-api").add(
        HttpApiGroup.make("users").add(
          HttpApiEndpoint.get("read", "/users", {
            query: { id: Schema.FiniteFromString },
            success: Schema.String,
          })
        )
      );
      const client = yield* makeUnusedHttpClient(api);
      const server = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["http-loader"],
      });
      const browser = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["http-loader"],
      });
      const input = Schema.Struct({
        query: Schema.Struct({ id: Schema.FiniteFromString }),
      });
      const descriptor = createQueryDescriptor(server.users.read, "metadata", {
        contract: "v1",
        input,
      }).capture({ query: { id: 7 } });
      const bound = createQueryDescriptor(browser.users.read, "metadata", {
        contract: "v1",
        input,
      }).bind(descriptor);
      expect(descriptor.input).toStrictEqual({ query: { id: "7" } });
      expect(bound.leaf.metadataKey(bound.input)).toStrictEqual(
        server.users.read.metadataKey({ query: { id: 7 } })
      );
      expect(bound.prefix).toStrictEqual([
        "http-loader",
        "http",
        "descriptor-api",
        "users",
        "read",
        "metadata",
      ]);
    })
);
