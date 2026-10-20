import dns from "node:dns";
import { request as nodeRequest } from "node:http";

import { SeedUser, User } from "@effect-api-query/contracts";
import type { DiagnosticStatus } from "@effect-api-query/contracts";
import {
  makeExampleRpcClient,
  startExampleRpcClient,
} from "@effect-api-query/contracts/client";
import type { ExampleRpcClient } from "@effect-api-query/contracts/client";
import { startExampleRpcServer } from "@effect-api-query/server";
import { describe, expect, it, vi } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Logger,
  Predicate,
  Result,
  Schema,
  Scope,
  Stream,
} from "effect";
import { RpcClient } from "effect/rpc";

import { makeDiagnosticOperations } from "../src/diagnostic-operations.ts";

const waitForStatus = Effect.fn("TestExampleRpc.waitForStatus")(
  function* waitForStatus(
    client: ExampleRpcClient,
    predicate: (status: DiagnosticStatus) => boolean
  ) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      // oxlint-disable-next-line unicorn/no-useless-undefined
      const status = yield* client("diagnostics.status", undefined);
      if (predicate(status)) {
        return status;
      }
      yield* Effect.sleep("10 millis");
    }
    return yield* Effect.die(
      new Error("Timed out waiting for diagnostic status")
    );
  }
);

describe("example RPC server", () => {
  it.effect(
    "keeps captured diagnostic statuses intact across later operations and reset",
    () =>
      Effect.gen(function* retainDiagnosticSnapshots() {
        const diagnostics = yield* makeDiagnosticOperations();
        const unused = yield* diagnostics.operationStatus("first");
        yield* diagnostics.slow({ operationId: "first", durationMs: 0 });
        const first = yield* diagnostics.operationStatus("first");
        const total = yield* diagnostics.status;
        yield* diagnostics.slow({ operationId: "first", durationMs: 0 });
        yield* diagnostics.slow({ operationId: "second", durationMs: 0 });
        expect({
          first: yield* diagnostics.operationStatus("first"),
          second: yield* diagnostics.operationStatus("second"),
          total: yield* diagnostics.status,
        }).toStrictEqual({
          first: { started: 2, interrupted: 0 },
          second: { started: 1, interrupted: 0 },
          total: { started: 3, interrupted: 0 },
        });
        yield* diagnostics.reset;
        expect({
          first: yield* diagnostics.operationStatus("first"),
          total: yield* diagnostics.status,
        }).toStrictEqual({
          first: { started: 0, interrupted: 0 },
          total: { started: 0, interrupted: 0 },
        });
        expect({ unused, first, total }).toStrictEqual({
          unused: { started: 0, interrupted: 0 },
          first: { started: 1, interrupted: 0 },
          total: { started: 1, interrupted: 0 },
        });
      })
  );

  it.live(
    "rejects oversized chunked bodies before the client finishes sending",
    () =>
      Effect.gen(function* rejectChunkedOverflow() {
        const server = yield* startExampleRpcServer();
        const status = yield* Effect.promise(
          async () =>
            // oxlint-disable-next-line promise/avoid-new
            await new Promise<number | undefined>((resolve, reject) => {
              const request = nodeRequest(
                server.rpcUrl,
                { method: "POST" },
                (response) => {
                  response.resume();
                  response.once("end", () => {
                    request.destroy();
                    resolve(response.statusCode);
                  });
                }
              );
              request.once("error", reject);
              request.setTimeout(1000, () => {
                request.destroy(new Error("Request timed out"));
              });
              request.write(" ".repeat(1024 * 1024 + 1));
            })
        );
        expect(status).toBe(413);
        expect(
          (yield* Effect.promise(
            async () => await fetch(`${server.url}/health`)
          )).status
        ).toBe(200);
      })
  );

  it.live(
    "rejects malformed request targets and continues serving requests",
    () =>
      Effect.gen(function* rejectMalformedTargets() {
        const server = yield* startExampleRpcServer();
        for (const path of ["//[", "http://user:password@localhost/rpc"]) {
          const status = yield* Effect.promise(
            async () =>
              // oxlint-disable-next-line promise/avoid-new
              await new Promise<number | undefined>((resolve, reject) => {
                const request = nodeRequest(
                  server.url,
                  { method: "POST", path },
                  (response) => {
                    response.resume();
                    response.once("end", () => {
                      resolve(response.statusCode);
                    });
                  }
                );
                request.once("error", reject);
                request.setTimeout(1000, () => {
                  request.destroy(new Error("Request timed out"));
                });
                request.end();
              })
          );
          expect(status).toBe(400);
        }
        expect(
          (yield* Effect.promise(
            async () => await fetch(`${server.url}/health`)
          )).status
        ).toBe(200);
        const client = yield* makeExampleRpcClient(server.rpcUrl);
        // oxlint-disable-next-line unicorn/no-useless-undefined
        expect(yield* client("users.list", undefined)).toHaveLength(12);
      })
  );

  it.effect("exposes readiness and returns 404 for unknown paths", () =>
    Effect.gen(function* exposeReadiness() {
      const server = yield* startExampleRpcServer();

      const readiness = yield* Effect.promise(
        async () => await fetch(`${server.url}/health`)
      );
      expect(readiness.status).toBe(200);
      const healthJson: unknown = yield* Effect.promise(async () => {
        const json: unknown = await readiness.json();
        return json;
      });
      expect(
        yield* Schema.decodeUnknownEffect(
          Schema.Struct({ status: Schema.Literal("ready") })
        )(healthJson)
      ).toStrictEqual({ status: "ready" });

      const missing = yield* Effect.promise(
        async () => await fetch(`${server.url}/missing`)
      );
      expect(missing.status).toBe(404);
    })
  );

  it.effect("exposes browser-safe RPC preflight metadata", () =>
    Effect.gen(function* rpcPreflightMetadata() {
      const server = yield* startExampleRpcServer();
      const preflight = yield* Effect.promise(
        async () =>
          await fetch(server.rpcUrl, {
            headers: {
              "access-control-request-headers":
                "baggage,content-type,traceparent,tracestate,x-example-authorization",
              "access-control-request-method": "POST",
              origin: "http://127.0.0.1:5173",
            },
            method: "OPTIONS",
          })
      );
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(preflight.headers.get("access-control-allow-headers")).toBe(
        "baggage,content-type,traceparent,tracestate,x-example-authorization"
      );
      expect(preflight.headers.get("access-control-allow-methods")).toContain(
        "POST"
      );
    })
  );

  it.effect("logs structured HTTP response metadata for RPC requests", () => {
    const entries: {
      readonly annotations: unknown;
      readonly message: unknown;
    }[] = [];
    // oxlint-disable-next-line typescript/no-invalid-void-type
    const collectingLogger = Logger.make<unknown, void>((options) => {
      const entry = Logger.formatStructured.log(options);
      const annotations: unknown = entry.annotations;
      const message: unknown = entry.message;
      entries.push({ annotations, message });
    });

    return Effect.gen(function* collectRpcResponseMetadata() {
      const server = yield* startExampleRpcServer();
      const client = yield* makeExampleRpcClient(server.rpcUrl);

      // oxlint-disable-next-line unicorn/no-useless-undefined
      yield* client("users.list", undefined);

      const expectedAnnotations: unknown = expect.objectContaining({
        "http.method": "POST",
        "http.status": 200,
        "http.url": "/rpc/",
      });
      expect(entries).toContainEqual({
        annotations: expectedAnnotations,
        message: "Sent HTTP response",
      });
    }).pipe(Effect.provide(Logger.layer([collectingLogger])));
  });

  it.effect(
    "serves deterministic user state over HTTP and resets it explicitly",
    () =>
      Effect.gen(function* resetUserDirectory() {
        const server = yield* startExampleRpcServer();
        const client = yield* makeExampleRpcClient(server.rpcUrl);
        // oxlint-disable-next-line unicorn/no-useless-undefined
        yield* client("testing.reset", undefined);

        // oxlint-disable-next-line unicorn/no-useless-undefined
        const initialDirectory = yield* client("users.list", undefined);
        expect({
          count: initialDirectory.length,
          first: initialDirectory[0],
          last: initialDirectory[11],
        }).toStrictEqual({
          count: 12,
          first: new User({ id: 1, locale: "en", name: "Ada Lovelace" }),
          last: new User({ id: 12, locale: "en", name: "James Gosling" }),
        });

        expect(
          yield* client("users.create", { name: "Grace Hopper" })
        ).toStrictEqual(
          new User({
            id: 13,
            locale: "en",
            name: "Grace Hopper",
          })
        );

        // oxlint-disable-next-line unicorn/no-useless-undefined
        expect(yield* client("testing.reset", undefined)).toBeUndefined();
        // oxlint-disable-next-line unicorn/no-useless-undefined
        expect(yield* client("users.list", undefined)).toStrictEqual(
          initialDirectory
        );
      })
  );

  it.live("seeds deterministic users and applies locale defaults", () =>
    Effect.gen(function* seedUserDefaults() {
      const server = yield* startExampleRpcServer();
      const client = yield* makeExampleRpcClient(server.rpcUrl);
      // oxlint-disable-next-line unicorn/no-useless-undefined
      yield* client("testing.reset", undefined);

      expect(
        yield* client("testing.seed", {
          users: [
            new SeedUser({ name: "Grace Hopper" }),
            new SeedUser({ locale: "nl", name: "Dijkstra" }),
          ],
        })
      ).toStrictEqual([
        new User({ id: 1, locale: "en", name: "Grace Hopper" }),
        new User({ id: 2, locale: "nl", name: "Dijkstra" }),
      ]);
      expect(yield* client("users.get", { id: 1 })).toStrictEqual(
        new User({
          id: 1,
          locale: "en",
          name: "Grace Hopper",
        })
      );
    })
  );

  it.live("requires authorization to delete a seeded user", () =>
    Effect.gen(function* authorizeUserDeletion() {
      const server = yield* startExampleRpcServer();
      const client = yield* makeExampleRpcClient(server.rpcUrl);
      yield* client("testing.seed", {
        users: [
          new SeedUser({ name: "Grace Hopper" }),
          new SeedUser({ locale: "nl", name: "Dijkstra" }),
        ],
      });

      const unauthorized = yield* Effect.flip(
        client("users.delete", { id: 1 })
      );
      expect(unauthorized).toMatchObject({
        _tag: "ExampleAuthorizationError",
        reason: "missing-example-authorization",
      });

      expect(
        yield* RpcClient.withHeaders(client("users.delete", { id: 1 }), {
          "x-example-authorization": "allowed",
        })
      ).toBeUndefined();
      // oxlint-disable-next-line unicorn/no-useless-undefined
      expect(yield* client("users.list", undefined)).toStrictEqual([
        new User({ id: 2, locale: "nl", name: "Dijkstra" }),
      ]);
    })
  );

  it.live("preserves declared diagnostic failures", () =>
    Effect.gen(function* declaredDiagnosticFailure() {
      const server = yield* startExampleRpcServer();
      const client = yield* makeExampleRpcClient(server.rpcUrl);

      const declaredFailure = yield* Effect.exit(
        // oxlint-disable-next-line unicorn/no-useless-undefined
        client("diagnostics.fail", undefined)
      );
      expect(Exit.isFailure(declaredFailure)).toBe(true);
      if (Exit.isSuccess(declaredFailure)) {
        return yield* Effect.die("Expected diagnostics.fail to fail");
      }
      expect(
        Result.getOrThrow(Cause.findError(declaredFailure.cause))
      ).toMatchObject({
        _tag: "DiagnosticFailure",
        reason: "requested-failure",
      });
      return yield* Effect.void;
    })
  );

  it.live("emits diagnostic stream messages in order", () =>
    Effect.gen(function* orderedDiagnosticStream() {
      const server = yield* startExampleRpcServer();
      const client = yield* makeExampleRpcClient(server.rpcUrl);

      const streamed = yield* Stream.runCollect(
        // oxlint-disable-next-line unicorn/no-useless-undefined
        client("diagnostics.stream", undefined)
      );
      expect([...streamed]).toStrictEqual([
        "Connection opened",
        "Permissions loaded",
        "Workspace synchronized",
        "Ready",
      ]);
    })
  );

  it.live("reports slow-operation interruption through the RPC interface", () =>
    Effect.gen(function* reportSlowInterruption() {
      const server = yield* startExampleRpcServer();
      const client = yield* makeExampleRpcClient(server.rpcUrl);
      // oxlint-disable-next-line unicorn/no-useless-undefined
      yield* client("testing.reset", undefined);
      const slow = yield* client("diagnostics.slow", {
        durationMs: 60_000,
      }).pipe(Effect.forkChild);

      expect(
        yield* waitForStatus(client, ({ started }) => started === 1)
      ).toStrictEqual({
        interrupted: 0,
        started: 1,
      });
      yield* Fiber.interrupt(slow);
      expect(
        yield* waitForStatus(client, ({ interrupted }) => interrupted === 1)
      ).toStrictEqual({
        interrupted: 1,
        started: 1,
      });
    })
  );

  it.live("finishes active client fibers before closing their RPC scope", () =>
    Effect.gen(function* disposeActiveClient() {
      const server = yield* startExampleRpcServer();
      const subject = yield* Effect.acquireRelease(
        Effect.promise(async () => await startExampleRpcClient(server.rpcUrl)),
        (client) =>
          Effect.promise(async () => {
            await client.dispose();
          }).pipe(Effect.orDie)
      );
      const observer = yield* makeExampleRpcClient(server.rpcUrl);
      // oxlint-disable-next-line unicorn/no-useless-undefined
      yield* observer("testing.reset", undefined);

      const running = subject.runPromiseExit(
        subject.client("diagnostics.slow", {
          durationMs: 60_000,
          operationId: "dispose-active-client",
        })
      );

      expect(
        yield* waitForStatus(observer, ({ started }) => started === 1)
      ).toStrictEqual({
        interrupted: 0,
        started: 1,
      });

      yield* Effect.promise(async () => {
        await subject.dispose();
      });
      expect(
        Exit.isFailure(yield* Effect.promise(async () => await running))
      ).toBe(true);
      expect(
        yield* waitForStatus(observer, ({ interrupted }) => interrupted === 1)
      ).toStrictEqual({
        interrupted: 1,
        started: 1,
      });
    })
  );

  it.live("tracks interruptions from independently created clients", () =>
    Effect.gen(function* interruptIndependentClients() {
      const server = yield* startExampleRpcServer();
      const firstClient = yield* makeExampleRpcClient(server.rpcUrl);
      const secondClient = yield* makeExampleRpcClient(server.rpcUrl);
      // oxlint-disable-next-line unicorn/no-useless-undefined
      yield* firstClient("testing.reset", undefined);
      const firstSlow = yield* firstClient("diagnostics.slow", {
        durationMs: 60_000,
      }).pipe(Effect.forkChild);
      const secondSlow = yield* secondClient("diagnostics.slow", {
        durationMs: 60_000,
      }).pipe(Effect.forkChild);

      expect(
        yield* waitForStatus(firstClient, ({ started }) => started === 2)
      ).toStrictEqual({
        interrupted: 0,
        started: 2,
      });
      yield* Fiber.interrupt(firstSlow);
      expect(
        yield* waitForStatus(
          firstClient,
          ({ interrupted }) => interrupted === 1
        )
      ).toStrictEqual({
        interrupted: 1,
        started: 2,
      });
      yield* Fiber.interrupt(secondSlow);
      expect(
        yield* waitForStatus(
          firstClient,
          ({ interrupted }) => interrupted === 2
        )
      ).toStrictEqual({
        interrupted: 2,
        started: 2,
      });
    })
  );

  it.live("stops accepting requests when its owner closes the Scope", () =>
    Effect.gen(function* closeServerScope() {
      const scope = yield* Scope.make();
      const server = yield* startExampleRpcServer().pipe(Scope.provide(scope));

      expect(
        (yield* Effect.promise(async () => await fetch(`${server.url}/health`)))
          .status
      ).toBe(200);
      yield* Scope.close(scope, Exit.void);
      yield* Effect.promise(async () => {
        await expect(fetch(`${server.url}/health`)).rejects.toThrow(
          "fetch failed"
        );
      });
    })
  );

  it.live("releases its listener when the owning fiber is interrupted", () =>
    Effect.gen(function* releaseInterruptedListener() {
      const listening = yield* Deferred.make<number>();
      const starting = yield* startExampleRpcServer().pipe(
        Effect.tap((server) => Deferred.succeed(listening, server.port)),
        Effect.andThen(Effect.never),
        Effect.scoped,
        Effect.forkChild
      );
      const port = yield* Deferred.await(listening);
      yield* Fiber.interrupt(starting);

      const replacement = yield* startExampleRpcServer({ port });
      expect(replacement.port).toBe(port);
      expect(
        (yield* Effect.promise(
          async () => await fetch(`${replacement.url}/health`)
        )).status
      ).toBe(200);
    })
  );

  it.live(
    "releases its listener when startup is interrupted during hostname resolution",
    () =>
      Effect.gen(function* interruptHostnameResolution() {
        const reservation = yield* Scope.make();
        const reserved = yield* startExampleRpcServer().pipe(
          Scope.provide(reservation)
        );
        const { port } = reserved;
        yield* Scope.close(reservation, Exit.void);

        const lookupRequested = yield* Deferred.make<() => void>();
        const lookup = yield* Effect.acquireRelease(
          Effect.sync(() => vi.spyOn(dns, "lookup")),
          (spy) =>
            Effect.sync(() => {
              spy.mockRestore();
            })
        );
        /* oxlint-disable promise/prefer-await-to-callbacks */
        lookup.mockImplementationOnce(
          (
            _hostname,
            optionsOrCallback:
              | dns.LookupOptions
              | ((
                  error: NodeJS.ErrnoException | null,
                  address: string,
                  family: number
                ) => void),
            callback?: (
              error: NodeJS.ErrnoException | null,
              addresses: dns.LookupAddress[]
            ) => void
          ) => {
            Deferred.doneUnsafe(
              lookupRequested,
              Effect.succeed(() => {
                if (Predicate.isFunction(optionsOrCallback)) {
                  optionsOrCallback(null, "127.0.0.1", 4);
                  return;
                }
                callback?.(null, [{ address: "127.0.0.1", family: 4 }]);
              })
            );
          }
        );
        /* oxlint-enable promise/prefer-await-to-callbacks */
        const starting = yield* startExampleRpcServer({
          host: "localhost",
          port,
        }).pipe(Effect.scoped, Effect.forkChild);
        const completeLookup = yield* Deferred.await(lookupRequested);
        const interruption = yield* Fiber.interrupt(starting).pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Effect.yieldNow;
        yield* Effect.sync(completeLookup);
        yield* Fiber.join(interruption);

        const replacement = yield* startExampleRpcServer({ port });
        expect(replacement.port).toBe(port);
      })
  );
});
