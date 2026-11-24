// @effect-diagnostics unstableApiUsage:off
import { exampleRpcGroup } from "@effect-api-query/contracts";
import { makeExampleRpcClient } from "@effect-api-query/contracts/client";
import { makeExampleHost } from "@effect-api-query/server/web-handler";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Option, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";

import { VerifiedCaller } from "../src/caller.ts";
import { makeCommands } from "../src/commands.ts";
import { makeDiagnosticOperations } from "../src/diagnostic-operations.ts";
import {
  commandReservationTtlMs,
  maxPendingCommandReservations,
  maxPendingCommandReservationsPerOwner,
} from "../src/operation-limits.ts";
import { openOperationSession } from "./fixtures/operation-session.ts";

const maxActiveOperations = 32;
const maxActiveOperationsPerOwner = 8;
const maxRetainedOperations = 256;

const asOwner = (operationOwner: string) =>
  Effect.provideService(VerifiedCaller, { operationOwner, writerId: null });

const inputs = (count: number) =>
  Array.from({ length: count }, (_, id) => ({
    operationId: `operation-${id}`,
  }));

describe("example operation limits", () => {
  it.effect(
    "admits commands within host and caller limits and reuses active work",
    () =>
      Effect.gen(function* boundCommandAdmission() {
        const commands = yield* makeCommands();
        const request = { operationId: "operation-0", steps: 100 };
        const ownerCount = maxActiveOperations / maxActiveOperationsPerOwner;
        const workers = [];
        for (let index = 0; index < ownerCount; index += 1) {
          for (const input of inputs(maxActiveOperationsPerOwner)) {
            workers.push(
              yield* commands
                .start({ ...request, ...input })
                .pipe(
                  asOwner(String(index)),
                  Effect.forkChild({ startImmediately: true })
                )
            );
          }
        }
        const waiting = { operationId: "waiting", steps: 1 };
        yield* commands.reserve(waiting).pipe(asOwner("0"));
        for (const owner of ["0", "next"]) {
          expect(
            yield* Effect.flip(commands.start(waiting).pipe(asOwner(owner)))
          ).toBe("operation-capacity-exceeded");
        }
        expect(yield* commands.status(waiting).pipe(asOwner("0"))).toBeNull();

        const duplicate = yield* commands
          .start({ ...request, steps: 1 })
          .pipe(asOwner("0"), Effect.forkChild({ startImmediately: true }));
        yield* commands.reserve(request).pipe(asOwner("0"));
        const cancelled = yield* commands.cancel(request).pipe(asOwner("0"));
        expect(cancelled).toMatchObject({
          state: "cancelled",
          totalSteps: 100,
        });
        expect(yield* Fiber.join(duplicate)).toStrictEqual(cancelled);

        expect(
          yield* Effect.flip(commands.start(waiting).pipe(asOwner("1")))
        ).toBe("operation-capacity-exceeded");
        const next = yield* commands
          .start(waiting)
          .pipe(asOwner("0"), Effect.forkChild({ startImmediately: true }));
        yield* TestClock.adjust("100 millis");
        const finished = yield* Fiber.join(next);
        yield* commands.reset;
        const drained = yield* Fiber.joinAll(workers);
        expect({ finished, drained: drained.length }).toMatchObject({
          finished: { state: "completed" },
          drained: maxActiveOperations,
        });
      })
  );

  it.effect("bounds pending reservations and reclaims them at expiry", () =>
    Effect.gen(function* expireReservations() {
      const commands = yield* makeCommands();
      const ownerCount =
        maxPendingCommandReservations / maxPendingCommandReservationsPerOwner;
      for (let index = 0; index < ownerCount; index += 1) {
        for (const input of inputs(maxPendingCommandReservationsPerOwner)) {
          yield* commands.reserve(input).pipe(asOwner(String(index)));
        }
      }
      const extra = { operationId: "extra" };
      for (const owner of ["0", "next"]) {
        expect(
          yield* Effect.flip(commands.reserve(extra).pipe(asOwner(owner)))
        ).toBe("operation-capacity-exceeded");
      }

      const held = { operationId: "operation-0" };
      yield* TestClock.adjust(commandReservationTtlMs - 1);
      yield* commands.reserve(held).pipe(asOwner("0"));
      expect(yield* commands.status(held).pipe(asOwner("0"))).toBeNull();
      yield* TestClock.adjust(1);
      expect(yield* Effect.flip(commands.cancel(held).pipe(asOwner("0")))).toBe(
        "operation-not-found"
      );
      yield* commands.reserve(extra).pipe(asOwner("next"));
      expect(yield* commands.status(extra).pipe(asOwner("next"))).toBeNull();
    })
  );

  it.effect(
    "evicts terminal command records without removing running work or reservations",
    () =>
      Effect.gen(function* evictCommandHistory() {
        const commands = yield* makeCommands();
        const oldest = { operationId: "oldest-completed", steps: 1 };
        const completed = yield* commands
          .start(oldest)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* TestClock.adjust("100 millis");
        expect(yield* Fiber.join(completed)).toMatchObject({
          state: "completed",
        });

        const held = { operationId: "held", steps: 1 };
        const delayed = { operationId: "delayed", steps: 1 };
        yield* commands.reserve(held).pipe(asOwner("another-owner"));
        yield* commands.reserve(delayed).pipe(asOwner("another-owner"));
        const earlyCancel = yield* commands
          .cancel(delayed)
          .pipe(asOwner("another-owner"));
        const running = { operationId: "running", steps: 100 };
        const worker = yield* commands
          .start(running)
          .pipe(Effect.forkChild({ startImmediately: true }));
        for (const input of inputs(maxRetainedOperations)) {
          yield* commands.reserve(input);
          yield* commands.reserve(input);
          yield* commands.cancel(input);
          yield* commands.start({ ...input, steps: 1 });
        }
        const cancelled = { operationId: "operation-0", steps: 1 };
        expect(yield* commands.start(cancelled)).toMatchObject({
          state: "cancelled",
          totalSteps: 0,
        });
        expect(yield* Effect.flip(commands.status(oldest))).toBe(
          "operation-not-found"
        );

        const reservation = yield* commands
          .status(held)
          .pipe(asOwner("another-owner"));
        yield* commands.cancel(held).pipe(asOwner("another-owner"));
        expect({
          reservation,
          earlyCancel,
          delayedStatus: yield* commands
            .status(delayed)
            .pipe(asOwner("another-owner")),
          reused: yield* commands.start(delayed).pipe(asOwner("another-owner")),
          evicted: yield* Effect.flip(commands.cancel(cancelled)),
        }).toMatchObject({
          reservation: null,
          earlyCancel: { state: "cancelled", totalSteps: 0 },
          delayedStatus: earlyCancel,
          reused: earlyCancel,
          evicted: "operation-not-found",
        });
        const status = yield* commands.status(running);
        const settled = yield* commands.cancel(running);
        expect({ status, settled }).toMatchObject({
          status: { state: "running" },
          settled: yield* Fiber.join(worker),
        });
      }).pipe(asOwner("owner"))
  );

  it.effect(
    "counts each active diagnostic attempt and evicts only inactive counters",
    () =>
      Effect.gen(function* boundDiagnosticAdmission() {
        const diagnostics = yield* makeDiagnosticOperations;
        const shared = { operationId: "shared", durationMs: 60_000 };
        const ownerCount = maxActiveOperations / maxActiveOperationsPerOwner;
        const attempts = [];
        for (let index = 0; index < ownerCount; index += 1) {
          for (let count = 0; count < maxActiveOperationsPerOwner; count += 1) {
            attempts.push(
              yield* diagnostics
                .slow(shared)
                .pipe(
                  asOwner(String(index)),
                  Effect.forkChild({ startImmediately: true })
                )
            );
          }
        }
        for (const owner of ["0", "next"]) {
          expect(
            yield* Effect.flip(diagnostics.slow(shared).pipe(asOwner(owner)))
          ).toBe("operation-capacity-exceeded");
        }

        for (const attempt of attempts.slice(0, maxActiveOperationsPerOwner)) {
          yield* Fiber.interrupt(attempt);
        }
        const finish = { durationMs: 0, operationId: "oldest" };
        yield* diagnostics.slow(finish).pipe(asOwner("0"));
        for (const input of inputs(maxRetainedOperations)) {
          yield* diagnostics
            .slow({ ...input, durationMs: 0 })
            .pipe(asOwner("0"));
        }
        expect(
          yield* Effect.flip(
            diagnostics.operationStatus("oldest").pipe(asOwner("0"))
          )
        ).toBe("operation-not-found");
        expect(yield* diagnostics.status.pipe(asOwner("0"))).toStrictEqual({
          started: maxActiveOperationsPerOwner + maxRetainedOperations + 1,
          interrupted: maxActiveOperationsPerOwner,
        });
        expect(
          yield* diagnostics.operationStatus("shared").pipe(asOwner("1"))
        ).toStrictEqual({
          started: maxActiveOperationsPerOwner,
          completed: 0,
          interrupted: 0,
        });

        yield* diagnostics.cancel("shared").pipe(asOwner("1"));
        for (const attempt of attempts.slice(
          maxActiveOperationsPerOwner,
          2 * maxActiveOperationsPerOwner
        )) {
          expect(Exit.hasInterrupts(yield* Fiber.await(attempt))).toBe(true);
        }
        yield* diagnostics.reset;
        for (const attempt of attempts) {
          expect(Exit.hasInterrupts(yield* Fiber.await(attempt))).toBe(true);
        }
        expect(yield* diagnostics.status.pipe(asOwner("1"))).toStrictEqual({
          started: 0,
          interrupted: 0,
        });
        yield* diagnostics
          .slow({ ...shared, durationMs: 0 })
          .pipe(asOwner("1"));
        expect(
          yield* diagnostics.operationStatus("shared").pipe(asOwner("1"))
        ).toStrictEqual({
          started: 1,
          completed: 1,
          interrupted: 0,
        });
      })
  );

  it.effect(
    "bounds idle owner totals independently of per-operation counters",
    () =>
      Effect.gen(function* evictIdleTotals() {
        const diagnostics = yield* makeDiagnosticOperations;
        for (let index = 0; index <= maxRetainedOperations; index += 1) {
          yield* diagnostics
            .slow({ durationMs: 0 })
            .pipe(asOwner(String(index)));
        }
        expect(yield* diagnostics.status.pipe(asOwner("0"))).toStrictEqual({
          started: 0,
          interrupted: 0,
        });
        expect(yield* diagnostics.status.pipe(asOwner("1"))).toStrictEqual({
          started: 1,
          interrupted: 0,
        });
      })
  );

  it.effect("settles a command when its worker scope closes", () =>
    Effect.gen(function* closeWorkerScope() {
      const scope = yield* Scope.make();
      const commands = yield* makeCommands().pipe(Scope.provide(scope));
      const request = { operationId: "running", steps: 100 };
      const worker = yield* commands
        .start(request)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Scope.close(scope, Exit.void);
      expect(yield* Fiber.join(worker)).toMatchObject({ state: "cancelled" });
      expect(
        yield* commands.start({ ...request, operationId: "after-close" })
      ).toMatchObject({
        state: "cancelled",
      });
    }).pipe(asOwner("owner"))
  );

  it.effect("applies the same input limits to decoded calls", () =>
    Effect.gen(function* checkDecodedInputs() {
      const commands = yield* makeCommands();
      const diagnostics = yield* makeDiagnosticOperations;
      const longId = { operationId: "x".repeat(101) };
      const invalid = "invalid-operation-input";

      expect({
        reservation: yield* Effect.flip(commands.reserve(longId)),
        command: yield* Effect.flip(commands.start({ ...longId, steps: 1 })),
        steps: yield* Effect.flip(
          commands.start({ operationId: "valid", steps: 101 })
        ),
        commandStatus: yield* Effect.flip(commands.status(longId)),
        commandCancel: yield* Effect.flip(commands.cancel(longId)),
        diagnostic: yield* Effect.flip(
          diagnostics.slow({ ...longId, durationMs: 0 })
        ),
        duration: yield* Effect.flip(diagnostics.slow({ durationMs: -1 })),
        diagnosticStatus: yield* Effect.flip(
          diagnostics.operationStatus(longId.operationId)
        ),
        diagnosticCancel: yield* Effect.flip(
          diagnostics.cancel(longId.operationId)
        ),
      }).toStrictEqual({
        reservation: invalid,
        command: invalid,
        steps: invalid,
        commandStatus: invalid,
        commandCancel: invalid,
        diagnostic: invalid,
        duration: invalid,
        diagnosticStatus: invalid,
        diagnosticCancel: invalid,
      });
    }).pipe(asOwner("owner"))
  );

  it.effect(
    "checks operation inputs and shares diagnostic admission across RPC and HTTP",
    () =>
      Effect.gen(function* shareDiagnosticAdmission() {
        const host = yield* makeExampleHost();
        const session = yield* Effect.promise(
          async () =>
            await openOperationSession(
              "https://example.test",
              host.handleRequest
            )
        );
        const client = yield* host
          .forRequest(session.request("/"))
          .makeRpcClient();
        const slow = exampleRpcGroup.requests.get("diagnostics.slow");
        if (slow === undefined) {
          return yield* Effect.die("Expected the slow diagnostic RPC contract");
        }
        const decodeSlow = Schema.decodeUnknownOption(slow.payloadSchema);
        const longId = "x".repeat(101);
        const longestId = "x".repeat(100);
        expect({
          longDuration: Option.isNone(decodeSlow({ durationMs: 60_001 })),
          longRpcId: Option.isNone(decodeSlow({ operationId: longId })),
          valid: Option.isSome(
            decodeSlow({ operationId: longestId, durationMs: 60_000 })
          ),
        }).toStrictEqual({ longDuration: true, longRpcId: true, valid: true });

        const send = (path: string, method = "POST") =>
          Effect.promise(
            async () =>
              await host.handleRequest(session.request(path, { method }))
          );
        const slowPath = "/api/diagnostics/slow?operationId=http&durationMs=";
        expect({
          longDuration: (yield* send(`${slowPath}60001`)).status,
          longHttpId: (yield* send(
            `/api/diagnostics/slow?operationId=${longId}&durationMs=0`
          )).status,
          longPathId: (yield* send(
            `/api/diagnostics/operations/${longId}`,
            "GET"
          )).status,
          valid: (yield* send(
            `/api/diagnostics/slow?operationId=${longestId}&durationMs=0`
          )).status,
          status: (yield* send(
            `/api/diagnostics/operations/${longestId}`,
            "GET"
          )).status,
        }).toStrictEqual({
          longDuration: 400,
          longHttpId: 400,
          longPathId: 404,
          valid: 200,
          status: 200,
        });

        const attempts = [];
        for (const input of inputs(maxActiveOperationsPerOwner)) {
          attempts.push(
            yield* client["diagnostics.slow"]({
              ...input,
              durationMs: 60_000,
            }).pipe(Effect.forkChild({ startImmediately: true }))
          );
        }
        yield* TestClock.adjust(1);
        expect(yield* client["diagnostics.status"]()).toStrictEqual({
          started: maxActiveOperationsPerOwner + 1,
          interrupted: 0,
        });
        const busy = yield* send(`${slowPath}0`);
        const network = yield* makeExampleRpcClient(
          "https://example.test/rpc",
          session.fetch
        );
        expect({
          status: busy.status,
          cacheControl: busy.headers.get("cache-control"),
          rpc: yield* Effect.flip(
            network["diagnostics.slow"]({ durationMs: 0 })
          ),
        }).toStrictEqual({
          status: 503,
          cacheControl: "no-store",
          rpc: "operation-capacity-exceeded",
        });

        const first = { operationId: "operation-0" };
        yield* client["diagnostics.cancel"](first);
        const [attempt] = attempts;
        if (attempt === undefined) {
          return yield* Effect.die("Expected an admitted diagnostic");
        }
        expect({
          interrupted: Exit.hasInterrupts(yield* Fiber.await(attempt)),
          accepted: (yield* send(`${slowPath}0`)).status,
        }).toStrictEqual({ interrupted: true, accepted: 200 });
        return yield* Effect.void;
      })
  );
});
