import { it } from "@effect/vitest";
import { dehydrate, hydrate } from "@tanstack/query-core";
import { Effect, Equivalence, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { expect } from "vite-plus/test";

import {
  acquireQueryOwner,
  configureUtils,
  createQueryDescriptor,
  createRpcQueryUtils,
  defineUtilsPolicy,
  queryEffects,
  QueryClientService,
  recoverStream,
  runQueryEvents,
  schemaStructuralSharing,
} from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";

it.effect(
  "composes loader selection, policy, sharing and recovered updates in independent owners",
  () =>
    Effect.gen(function* integratedOwners() {
      const value = Schema.Struct({ id: Schema.Int, name: Schema.String });
      const group = RpcGroup.make(
        Rpc.make("read", { payload: { id: Schema.Int }, success: value }),
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      let requests = 0;
      const client = yield* makeRpcTestClient(group, {
        read: ({ id }) => {
          requests += 1;
          return Effect.succeed({ id, name: "initial" });
        },
        watch: () => Stream.make(1, 2, 3),
      });
      const context = yield* Effect.context();
      const run = Effect.runPromiseWith(context);
      const acquire = async () =>
        await acquireQueryOwner(async (setup) => {
          const raw = createRpcQueryUtils(group, {
            client: setup.borrow(client),
            keyPrefix: ["combined"],
            runPromiseExit: setup.wrapRunner(Effect.runPromiseExit),
          });
          const policy = defineUtilsPolicy<typeof raw>()({
            query: { policy: { staleTime: Infinity, retry: false } },
          });
          return await Promise.resolve(configureUtils(raw, policy));
        });
      yield* Effect.promise(async () => {
        const server = await acquire();
        const browser = await acquire();
        try {
          const descriptor = (leaf: typeof server.resources.read) =>
            createQueryDescriptor(leaf, "query", {
              contract: "combined-v1",
              input: Schema.Struct({ id: Schema.Int }),
            });
          const selected = descriptor(server.resources.read).capture({ id: 7 });
          const bound = descriptor(server.resources.read).bind(selected);
          const loaded = await server.queryClient.query(
            bound.leaf.queryOptions({ input: bound.input })
          );
          hydrate(browser.queryClient, dehydrate(server.queryClient));
          const received = descriptor(browser.resources.read).bind(selected);
          const options = received.leaf.queryOptions({ input: received.input });
          const cached = await run(
            queryEffects
              .ensure(options)
              .pipe(
                Effect.provideService(QueryClientService, browser.queryClient)
              )
          );
          expect(cached).toStrictEqual(loaded);
          expect({
            requests,
            cache: server.queryClient.getQueryCache().getAll().length,
          }).toStrictEqual({ requests: 1, cache: 1 });
          const sharing = schemaStructuralSharing(value, {
            equivalence: Equivalence.make(
              (a, b) => a.id === b.id && a.name === b.name
            ),
          });
          browser.queryClient.setQueryDefaults(options.queryKey, {
            structuralSharing: sharing,
          });
          await runQueryEvents(
            browser,
            recoverStream({
              initialCursor: "event-0",
              cursorPolicy: { accept: (previous, next) => next > previous },
              connect: () => Stream.make("event-1", "event-1", "event-2"),
              cursor: (position) => position,
              retryDelay: () => {},
            }),
            {
              onEvent: () =>
                queryEffects
                  .setData(options.queryKey, { id: 7, name: "initial" })
                  .pipe(Effect.asVoid),
            },
            Effect.runPromiseExit
          );
          expect(browser.queryClient.getQueryData(options.queryKey)).toBe(
            cached
          );

          const live = browser.resources.watch.liveOptions({ coalesceMs: 50 });
          await expect(browser.queryClient.query(live)).resolves.toBe(3);
          await server.dispose();
          server.commit((cache) => {
            cache.setQueryData(options.queryKey, { id: 7, name: "late" });
          });
          expect(browser.queryClient.getQueryData(options.queryKey)).toBe(
            cached
          );
        } finally {
          await server.dispose();
          await browser.dispose();
        }
        expect(browser.queryClient.getQueryCache().getAll()).toHaveLength(0);
      });
    })
);
