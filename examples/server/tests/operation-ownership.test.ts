// @effect-diagnostics unstableApiUsage:off
import { makeExampleRpcClient } from "@effect-api-query/contracts/client";
import { startExampleRpcServer } from "@effect-api-query/server";
import { makeExampleHost } from "@effect-api-query/server/web-handler";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { openOperationSession } from "./fixtures/operation-session.ts";

describe("example operation ownership", () => {
  it.live(
    "isolates same-ID reservations, start reuse, progress, and cancellation",
    () =>
      Effect.gen(function* isolateCommands() {
        const server = yield* startExampleRpcServer();
        const [first, second] = yield* Effect.promise(
          async () =>
            await Promise.all([
              openOperationSession(server.url),
              openOperationSession(server.url),
            ])
        );
        const a = yield* makeExampleRpcClient(server.rpcUrl, first.fetch);
        const b = yield* makeExampleRpcClient(server.rpcUrl, second.fetch);
        const anonymous = yield* makeExampleRpcClient(server.rpcUrl);
        const input = { operationId: "shared" };
        const unknown = { operationId: "unknown" };

        expect(
          yield* Effect.flip(anonymous["commands.reserve"](input))
        ).toMatchObject({
          _tag: "ExampleAuthorizationError",
        });
        yield* a["commands.reserve"](input);
        expect({
          foreign: yield* Effect.flip(b["commands.cancel"](input)),
          unknown: yield* Effect.flip(b["commands.cancel"](unknown)),
        }).toStrictEqual({
          foreign: "operation-not-found",
          unknown: "operation-not-found",
        });
        yield* b["commands.reserve"](input);
        const cancelled = yield* a["commands.cancel"](input);
        const reused = yield* a["commands.start"]({ ...input, steps: 2 });
        expect({ cancelled, reused }).toMatchObject({
          cancelled: { state: "cancelled", completedSteps: 0 },
          reused: cancelled,
        });

        const running = yield* b["commands.start"]({
          ...input,
          steps: 40,
        }).pipe(Effect.forkChild);
        const duplicate = yield* b["commands.start"]({
          ...input,
          steps: 40,
        }).pipe(Effect.forkChild);
        const context = yield* Effect.context();
        yield* Effect.promise(async () => {
          await expect
            .poll(
              async () =>
                await Effect.runPromiseWith(context)(
                  b["commands.status"](input)
                )
            )
            .toMatchObject({ state: "running", totalSteps: 40 });
        });
        const firstStatus = yield* a["commands.status"](input);
        const firstCancel = yield* a["commands.cancel"](input);
        const result = yield* b["commands.cancel"](input);

        const privateInput = { operationId: "one-owner" };
        yield* a["commands.start"]({ ...privateInput, steps: 1 });
        expect({
          firstStatus,
          firstCancel,
          result,
          running: yield* Fiber.join(running),
          duplicate: yield* Fiber.join(duplicate),
          foreignStatus: yield* Effect.flip(b["commands.status"](privateInput)),
          unknownStatus: yield* Effect.flip(b["commands.status"](unknown)),
          foreignCancel: yield* Effect.flip(b["commands.cancel"](privateInput)),
        }).toMatchObject({
          firstStatus: cancelled,
          firstCancel: cancelled,
          result: { state: "cancelled", totalSteps: 40 },
          running: result,
          duplicate: result,
          foreignStatus: "operation-not-found",
          unknownStatus: "operation-not-found",
          foreignCancel: "operation-not-found",
        });
      })
  );

  it.live(
    "isolates diagnostic activity and missing results across RPC and HTTP",
    () =>
      Effect.gen(function* isolateDiagnostics() {
        const server = yield* startExampleRpcServer();
        const [first, second] = yield* Effect.promise(
          async () =>
            await Promise.all([
              openOperationSession(server.url),
              openOperationSession(server.url),
            ])
        );
        const a = yield* makeExampleRpcClient(server.rpcUrl, first.fetch);
        const b = yield* makeExampleRpcClient(server.rpcUrl, second.fetch);
        const input = { operationId: "shared", durationMs: 60_000 };
        const statusUrl = `${server.url}/api/diagnostics/operations/shared`;
        const running = yield* a["diagnostics.slow"](input).pipe(
          Effect.forkChild
        );
        const waitForStart = (fetchStatus: typeof fetch) =>
          Effect.promise(async () => {
            await expect
              .poll(async () => {
                const response = await fetchStatus(statusUrl);
                const status: unknown = await response.json();
                return status;
              })
              .toStrictEqual({ started: 1, interrupted: 0 });
          });
        yield* waitForStart(first.fetch);
        const missing = yield* Effect.promise(
          async () => await second.fetch(statusUrl)
        );
        expect({
          status: yield* Effect.flip(b["diagnostics.operationStatus"](input)),
          cancel: yield* Effect.flip(b["diagnostics.cancel"](input)),
          http: missing.status,
          cacheControl: missing.headers.get("cache-control"),
        }).toStrictEqual({
          status: "operation-not-found",
          cancel: "operation-not-found",
          http: 404,
          cacheControl: "no-store",
        });

        // @effect-diagnostics-next-line abortControllerInEffect:off
        const controller = new AbortController();
        const secondResult = second
          .fetch(
            `${server.url}/api/diagnostics/slow?operationId=shared&durationMs=60000`,
            { method: "POST", signal: controller.signal }
          )
          .catch(() => "aborted");
        try {
          yield* waitForStart(second.fetch);
          yield* a["diagnostics.cancel"](input);
          expect({
            interrupted: Exit.hasInterrupts(yield* Fiber.await(running)),
            otherStatus: yield* b["diagnostics.operationStatus"](input),
          }).toStrictEqual({
            interrupted: true,
            otherStatus: { started: 1, interrupted: 0 },
          });
        } finally {
          controller.abort();
          yield* Effect.promise(async () => await secondResult);
        }
        yield* a["diagnostics.slow"]({ durationMs: 0 });
        expect({
          owner: yield* a["diagnostics.status"](),
          other: yield* b["diagnostics.status"](),
        }).toMatchObject({
          owner: { started: 2, interrupted: 1 },
          other: { started: 1 },
        });
      })
  );

  it.effect(
    "renews the same owner before expiry and gives an expired caller a fresh scope",
    () =>
      Effect.gen(function* renewOperationSession() {
        const host = yield* makeExampleHost("write-token");
        const origin = "https://example.test";
        const session = yield* Effect.promise(
          async () => await openOperationSession(origin, host.handleRequest)
        );
        const client = yield* host
          .forRequest(session.request("/"))
          .makeRpcClient();
        const input = { operationId: "reserved" };
        yield* client["commands.reserve"](input);
        expect(
          yield* Effect.flip(client["users.delete"]({ id: 1 }))
        ).toMatchObject({ _tag: "ExampleAuthorizationError" });
        const deleteStatus = yield* Effect.promise(async () => {
          const response = await host.handleRequest(
            session.request("/api/users/1", { method: "DELETE" })
          );
          return response.status;
        });
        expect(deleteStatus).toBe(401);

        yield* TestClock.adjust("30 minutes");
        const renewed = yield* Effect.promise(
          async () =>
            await openOperationSession(
              origin,
              host.handleRequest,
              session.cookie
            )
        );
        yield* TestClock.adjust("30 minutes");
        const expired = yield* host
          .forRequest(session.request("/"))
          .makeRpcClient();
        expect(
          yield* Effect.flip(expired["commands.cancel"](input))
        ).toMatchObject({ _tag: "ExampleAuthorizationError" });
        const continued = yield* host
          .forRequest(renewed.request("/"))
          .makeRpcClient();
        expect(yield* continued["commands.cancel"](input)).toMatchObject({
          state: "cancelled",
        });

        const replacement = yield* Effect.promise(
          async () =>
            await openOperationSession(
              origin,
              host.handleRequest,
              session.cookie
            )
        );
        const fresh = yield* host
          .forRequest(replacement.request("/"))
          .makeRpcClient();
        expect(yield* Effect.flip(fresh["commands.cancel"](input))).toBe(
          "operation-not-found"
        );
      })
  );
});
