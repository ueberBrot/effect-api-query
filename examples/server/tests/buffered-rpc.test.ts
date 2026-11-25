// @effect-diagnostics unstableApiUsage:off
import { SeedUser } from "@effect-api-query/contracts";
import { makeExampleWebHandler } from "@effect-api-query/server/web-handler";
import { describe, expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Layer, Schema, Scope } from "effect";

import { ExampleDomain } from "../src/domain.ts";

const maxBufferedRpcOperations = 16;
const maxBufferedRpcResponseBytes = 1024 * 1024;

const rpc = (id: number, tag: string, payload: Schema.Json = null) => ({
  _tag: "Request",
  id: String(id),
  tag,
  headers: [],
  payload,
});

type RpcRequest = ReturnType<typeof rpc>;

const postRpc = (messages: RpcRequest | readonly RpcRequest[]) =>
  new Request("http://localhost/rpc", {
    method: "POST",
    body: JSON.stringify(messages),
  });

const readReplies = (response: Response) =>
  Effect.promise(async () => await response.text()).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Array(Schema.Json))
      )
    )
  );

describe("example buffered RPC limits", () => {
  it.effect(
    "accepts the operation limit and rejects the next operation before dispatch",
    () =>
      Effect.gen(function* verifyOperationCount() {
        let calls = 0;
        const layer = Layer.effect(
          ExampleDomain,
          Effect.gen(function* countListCalls() {
            const domain = yield* ExampleDomain;
            return {
              ...domain,
              users: {
                ...domain.users,
                list: () =>
                  Effect.sync(() => {
                    calls += 1;
                    return [];
                  }),
              },
            };
          })
        ).pipe(Layer.provide(ExampleDomain.layer));
        const handle = yield* makeExampleWebHandler(layer);
        const batch = Array.from(
          { length: maxBufferedRpcOperations + 1 },
          (_, index) => rpc(index, "users.list")
        );

        const refused = yield* Effect.promise(
          async () => await handle(postRpc(batch))
        );
        expect(refused.status).toBe(413);
        expect(calls).toBe(0);

        const allowed = yield* Effect.promise(
          async () =>
            await handle(postRpc(batch.slice(0, maxBufferedRpcOperations)))
        );
        expect(allowed.status).toBe(200);
        const replies = yield* readReplies(allowed);
        expect(replies).toHaveLength(maxBufferedRpcOperations);
        expect(calls).toBe(maxBufferedRpcOperations);
      })
  );

  it.effect(
    "counts exact UTF-8 bytes across JSON replies, including escaping and separators",
    () =>
      Effect.gen(function* verifyResponseBytes() {
        const scope = yield* Scope.Scope;
        const context = yield* Layer.buildWithScope(ExampleDomain.layer, scope);
        const { users } = Context.get(context, ExampleDomain);
        const handle = yield* makeExampleWebHandler(
          Layer.succeedContext(context)
        );
        const batch = [
          rpc(0, "users.get", { id: 1 }),
          rpc(1, "users.get", { id: 2 }),
        ];
        const name = 'é😀"\n';
        const send = Effect.promise(async () => await handle(postRpc(batch)));

        yield* users.seed({
          users: [new SeedUser({ name }), new SeedUser({ name })],
        });
        const initial = yield* send;
        expect(initial.status).toBe(200);
        const baseline = yield* Effect.promise(
          async () => await initial.arrayBuffer()
        );

        const padding = maxBufferedRpcResponseBytes - baseline.byteLength;
        const fill = "é".repeat(Math.floor(padding / 4));
        const remainder = padding - 4 * fill.length;
        yield* users.seed({
          users: [
            new SeedUser({ name: name + fill }),
            new SeedUser({ name: name + fill + "a".repeat(remainder) }),
          ],
        });
        const exact = yield* send;
        expect(exact.status).toBe(200);
        const bytes = yield* Effect.promise(
          async () => await exact.clone().arrayBuffer()
        );
        expect(bytes.byteLength).toBe(maxBufferedRpcResponseBytes);
        expect(yield* readReplies(exact)).toHaveLength(2);

        yield* users.seed({
          users: [
            new SeedUser({ name: name + fill }),
            new SeedUser({ name: name + fill + "a".repeat(remainder + 1) }),
          ],
        });
        const refused = yield* Effect.promise(
          async () => await handle(postRpc(batch))
        );
        const message = yield* Effect.promise(async () => await refused.text());
        expect({ status: refused.status, message }).toStrictEqual({
          status: 413,
          message: "RPC response exceeds the byte limit",
        });
      })
  );

  it.effect(
    "interrupts pending RPC work on overflow and leaves the host available",
    () =>
      Effect.gen(function* verifyOverflowCleanup() {
        const started = yield* Deferred.make<null>();
        const finished = yield* Deferred.make<null>();
        const layer = Layer.effect(
          ExampleDomain,
          Effect.gen(function* observePendingWork() {
            const domain = yield* ExampleDomain;
            return {
              ...domain,
              users: {
                ...domain.users,
                get: () =>
                  Effect.andThen(
                    Deferred.succeed(started, null),
                    Effect.never
                  ).pipe(Effect.ensuring(Deferred.succeed(finished, null))),
                list: () =>
                  Effect.andThen(Deferred.await(started), domain.users.list()),
              },
            };
          })
        ).pipe(Layer.provide(ExampleDomain.layer));
        const scope = yield* Scope.Scope;
        const context = yield* Layer.buildWithScope(layer, scope);
        const { users } = Context.get(context, ExampleDomain);
        yield* users.seed({
          users: [
            new SeedUser({ name: "é".repeat(maxBufferedRpcResponseBytes / 2) }),
          ],
        });
        const handle = yield* makeExampleWebHandler(
          Layer.succeedContext(context)
        );

        const received = yield* Effect.promise(
          async () =>
            await handle(
              postRpc([rpc(0, "users.get", { id: 1 }), rpc(1, "users.list")])
            )
        );
        expect(received.status).toBe(413);
        yield* Deferred.await(finished);

        const subsequent = yield* Effect.promise(
          async () => await handle(postRpc(rpc(2, "diagnostics.ping")))
        );
        expect(subsequent.status).toBe(200);
        const replies = yield* readReplies(subsequent);
        expect(replies).toStrictEqual([
          {
            _tag: "Exit",
            requestId: "2",
            exit: { _tag: "Success", value: null },
          },
        ]);
      })
  );
});
