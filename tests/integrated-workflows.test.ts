import { it } from "@effect/vitest";
import { dehydrate, hydrate } from "@tanstack/query-core";
import { Effect, Equivalence, Exit, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { expect } from "vite-plus/test";

import {
  acquireQueryOwner,
  configureUtils,
  createQueryDescriptor,
  createRpcQueryUtils,
  defineRpcPolicy,
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
            runtime: setup.wrapRunner(Effect.runPromiseExit),
          });
          const policy = defineRpcPolicy.withClientError<never>()(
            group,
            {
              query: { staleTime: Infinity, retry: false },
            },
            { keyPrefix: ["combined"] }
          );
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
              .query({ ...options, staleTime: "static" })
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
          const events: string[] = [];
          const stored: (
            | { readonly id: number; readonly name: string }
            | undefined
          )[] = [];
          const consumed = await runQueryEvents(
            browser,
            recoverStream({
              initialCursor: "event-0",
              cursorPolicy: { accept: (previous, next) => next > previous },
              connect: () => Stream.make("event-1", "event-1", "event-2"),
              cursor: (position) => position,
              retryDelay: () => {},
            }),
            {
              onEvent: (event) =>
                queryEffects
                  .setData(options.queryKey, { id: 7, name: "updated" })
                  .pipe(
                    Effect.tap((data) =>
                      Effect.sync(() => {
                        events.push(event);
                        stored.push(data);
                      })
                    ),
                    Effect.asVoid
                  ),
            },
            Effect.runPromiseExit
          );
          const updated = browser.queryClient.getQueryData(options.queryKey);
          expect({
            success: Exit.isSuccess(consumed),
            events,
            updated,
            reused: updated === stored[0] && updated === stored[1],
          }).toStrictEqual({
            success: true,
            events: ["event-1", "event-2"],
            updated: { id: 7, name: "updated" },
            reused: true,
          });

          const live = browser.resources.watch.liveOptions({ coalesceMs: 50 });
          await expect(browser.queryClient.query(live)).resolves.toBe(3);
          await server.dispose();
          server.commit((cache) => {
            cache.setQueryData(options.queryKey, { id: 7, name: "late" });
          });
          expect(browser.queryClient.getQueryData(options.queryKey)).toBe(
            updated
          );
        } finally {
          await server.dispose();
          await browser.dispose();
        }
        expect(browser.queryClient.getQueryCache().getAll()).toHaveLength(0);
      });
    })
);
