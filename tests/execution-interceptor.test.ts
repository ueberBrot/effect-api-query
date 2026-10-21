import { expect, it } from "@effect/vitest";
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  createRpcQueryUtils,
  skipToken,
  withMutationInterceptor,
  withMutationPolicy,
  withQueryInterceptor,
} from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";

it.effect(
  "runs query interceptors for native retry attempts without changing keys or skipToken",
  () =>
    Effect.gen(function* interceptsRetryAttempts() {
      const group = RpcGroup.make(
        Rpc.make("read", {
          payload: { id: Schema.Int },
          success: Schema.Int,
          error: Schema.Literal("busy"),
        })
      );
      let attempts = 0;
      const client = yield* makeRpcTestClient(group, {
        read: ({ id }) =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts === 1
              ? Effect.fail("busy" as const)
              : Effect.succeed(id);
          }),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["interceptors"],
      });
      const events: string[] = [];
      const read = withQueryInterceptor(
        rpc.read,
        "query",
        async ({ context, next }) => {
          events.push(context.signal.aborted ? "aborted" : "start");
          try {
            return await next();
          } finally {
            events.push("finish");
          }
        }
      );
      const skipped = read({ input: skipToken });
      expect(skipped.queryFn).toBe(skipToken);
      const options = read({ input: { id: 42 }, retry: 1, retryDelay: 0 });
      expect(options.queryKey).toStrictEqual(rpc.read.queryKey({ id: 42 }));
      const queryClient = new QueryClient();
      expect(
        yield* Effect.promise(async () => await queryClient.query(options))
      ).toBe(42);
      expect(events).toStrictEqual(["start", "finish", "start", "finish"]);
      queryClient.clear();
    })
);

it.effect(
  "composes awaited shared mutation callbacks before local optimistic callbacks",
  () =>
    Effect.gen(function* composesMutationCallbacks() {
      const group = RpcGroup.make(
        Rpc.make("read", { success: Schema.Int }),
        Rpc.make("write", {
          payload: { value: Schema.Int },
          success: Schema.Int,
        })
      );
      let value = 1;
      const client = yield* makeRpcTestClient(group, {
        read: () => Effect.sync(() => value),
        write: ({ value: nextValue }) =>
          Effect.sync(() => {
            value = nextValue;
            return value;
          }),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["interceptors"],
      });
      const queryClient = new QueryClient();
      const events: string[] = [];
      yield* Effect.promise(
        async () =>
          await queryClient.query(
            rpc.read.queryOptions({ staleTime: Infinity })
          )
      );
      const write = withMutationPolicy(
        rpc.write,
        {
          onSuccess: async (_data, _input, _optimistic, context) => {
            await context.client.invalidateQueries({
              queryKey: rpc.read.key(),
            });
            events.push("shared success");
          },
          onSettled: () => events.push("shared settled"),
        },
        { callbacks: "compose" }
      );
      const observer = new MutationObserver(
        queryClient,
        write({
          onMutate: ({ value: next }) => ({ previous: next - 1 }),
          onSuccess: (_data, _input, optimistic) =>
            events.push(`local ${optimistic.previous}`),
          onSettled: () => events.push("local settled"),
        })
      );
      expect(
        yield* Effect.promise(async () => await observer.mutate({ value: 2 }))
      ).toBe(2);
      expect(events).toStrictEqual([
        "shared success",
        "local 1",
        "shared settled",
        "local settled",
      ]);
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(
              rpc.read.queryOptions({ staleTime: Infinity })
            )
        )
      ).toBe(2);
      queryClient.clear();
    })
);

it.effect(
  "keeps mutation interceptors active with local callbacks and optional native context",
  () =>
    Effect.gen(function* interceptsMutationContexts() {
      const group = RpcGroup.make(
        Rpc.make("write", {
          payload: { value: Schema.Int },
          success: Schema.Int,
        })
      );
      let writes = 0;
      const client = yield* makeRpcTestClient(group, {
        write: ({ value }) =>
          Effect.sync(() => {
            writes += 1;
            return value;
          }),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["interceptors"],
      });
      const events: string[] = [];
      const contexts: boolean[] = [];
      const write = withMutationInterceptor(
        rpc.write,
        async ({ input, context, next: execute }) => {
          const value = await execute();
          contexts.push(context !== undefined);
          context?.client.setQueryData(["written"], input.value);
          events.push("interceptor");
          return value;
        }
      );
      const queryClient = new QueryClient();
      const observer = new MutationObserver(
        queryClient,
        write({ onSuccess: () => events.push("local success") })
      );
      expect(
        yield* Effect.promise(async () => await observer.mutate({ value: 7 }))
      ).toBe(7);
      expect(queryClient.getQueryData(["written"])).toBe(7);
      expect(events).toStrictEqual(["interceptor", "local success"]);
      expect(
        yield* Effect.promise(
          async () => await write().mutationFn({ value: 9 })
        )
      ).toBe(9);
      expect({ contexts, writes }).toStrictEqual({
        contexts: [true, false],
        writes: 2,
      });
      queryClient.clear();
    })
);

it.effect("rejects duplicate execution within one mutation attempt", () =>
  Effect.gen(function* rejectsDuplicateMutationExecution() {
    const group = RpcGroup.make(Rpc.make("write", { success: Schema.Int }));
    let writes = 0;
    const client = yield* makeRpcTestClient(group, {
      write: () =>
        Effect.sync(() => {
          writes += 1;
          return writes;
        }),
    });
    const rpc = createRpcQueryUtils(group, {
      client,
      keyPrefix: ["duplicate-interceptor"],
    });
    const duplicate = withMutationInterceptor(
      rpc.write,
      async ({ next: execute }) => {
        await execute();
        return await execute();
      }
    );
    const queryClient = new QueryClient();
    try {
      const mutation = new MutationObserver(queryClient, duplicate());
      yield* Effect.promise(async () => {
        await expect(mutation.mutate()).rejects.toThrow(
          "only once per attempt"
        );
      });
      expect(writes).toBe(1);
    } finally {
      queryClient.clear();
    }
  })
);
