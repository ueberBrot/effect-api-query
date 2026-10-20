import {
  DiagnosticStatus,
  exampleHttpApi,
  User,
  UserPage,
} from "@effect-api-query/contracts";
import { makeExampleRpcClient } from "@effect-api-query/contracts/client";
import { startExampleRpcServer } from "@effect-api-query/server";
import { makeExampleWebHandler } from "@effect-api-query/server/web-handler";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Schema, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

describe("example HTTP API", () => {
  it.effect(
    "shares user state with RPC and returns no content after deletion",
    () =>
      Effect.gen(function* shareRpcHttpUserState() {
        const server = yield* startExampleRpcServer();
        const rpc = yield* makeExampleRpcClient(server.rpcUrl);
        const created = yield* Effect.promise(
          async () =>
            await fetch(`${server.url}/api/users`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: "Grace Hopper" }),
            })
        );
        expect(created.status).toBe(200);
        const createdJson: unknown = yield* Effect.promise(async () => {
          const json: unknown = await created.json();
          return json;
        });
        expect(
          yield* Schema.decodeUnknownEffect(User)(createdJson)
        ).toStrictEqual(
          new User({
            id: 13,
            locale: "en",
            name: "Grace Hopper",
          })
        );
        expect(yield* rpc("users.get", { id: 13 })).toMatchObject({
          name: "Grace Hopper",
        });
        const removed = yield* Effect.promise(
          async () =>
            await fetch(`${server.url}/api/users/13`, {
              method: "DELETE",
              headers: { "x-example-authorization": "allowed" },
            })
        );
        expect({
          status: removed.status,
          body: yield* Effect.promise(async () => await removed.text()),
        }).toStrictEqual({ status: 204, body: "" });
        expect(yield* Effect.flip(rpc("users.get", { id: 13 }))).toBe(
          "user-not-found"
        );
      })
  );

  it.effect("decodes params, query, and buffered pages", () =>
    Effect.gen(function* decodeHttpInputs() {
      const server = yield* startExampleRpcServer();
      const client = yield* HttpApiClient.make(exampleHttpApi, {
        baseUrl: server.url,
      }).pipe(Effect.provide(FetchHttpClient.layer));
      expect(yield* client.users.list()).toHaveLength(12);
      expect(
        yield* client.users.get({ params: { id: 1 }, query: { locale: "de" } })
      ).toStrictEqual(
        new User({
          id: 1,
          locale: "de",
          name: "Ada Lovelace",
        })
      );
      expect(
        yield* client.users.page({ query: { cursor: 10, pageSize: 5 } })
      ).toStrictEqual(
        new UserPage({
          nextCursor: null,
          total: 12,
          users: [
            new User({ id: 11, locale: "en", name: "Annie Easley" }),
            new User({ id: 12, locale: "en", name: "James Gosling" }),
          ],
        })
      );
    })
  );

  it.effect("preserves declared HTTP errors and authorization failures", () =>
    Effect.gen(function* declaredHttpFailures() {
      const server = yield* startExampleRpcServer();
      const client = yield* HttpApiClient.make(exampleHttpApi, {
        baseUrl: server.url,
      }).pipe(Effect.provide(FetchHttpClient.layer));
      expect(
        yield* Effect.flip(client.users.get({ params: { id: 99 }, query: {} }))
      ).toBe("user-not-found");
      expect(
        yield* Effect.flip(client.users.delete({ params: { id: 1 } }))
      ).toMatchObject({
        _tag: "ExampleAuthorizationError",
        reason: "missing-example-authorization",
      });
      expect(yield* Effect.flip(client.diagnostics.fail())).toMatchObject({
        _tag: "DiagnosticFailure",
        reason: "requested-failure",
        message: "requested-failure",
      });
    })
  );

  it.live("interrupts server work when the HTTP request is aborted", () =>
    Effect.gen(function* abortHttpServerWork() {
      const server = yield* startExampleRpcServer();
      const rpc = yield* makeExampleRpcClient(server.rpcUrl);
      const context = yield* Effect.context();
      // @effect-diagnostics-next-line abortControllerInEffect:off
      const controller = new AbortController();
      const pending = fetch(
        `${server.url}/api/diagnostics/slow?durationMs=60000&operationId=http-abort`,
        {
          signal: controller.signal,
        }
      ).then(
        () => "completed",
        () => "aborted"
      );
      yield* Effect.promise(async () => {
        await expect
          .poll(
            async ({ signal }) =>
              await Effect.runPromiseWith(context)(
                // oxlint-disable-next-line unicorn/no-useless-undefined
                rpc("diagnostics.status", undefined),
                { signal }
              )
          )
          .toMatchObject({ started: 1 });
      });
      controller.abort();
      expect(yield* Effect.promise(async () => await pending)).toBe("aborted");
      yield* Effect.promise(async () => {
        await expect
          .poll(
            async ({ signal }) =>
              await Effect.runPromiseWith(context)(
                // oxlint-disable-next-line unicorn/no-useless-undefined
                rpc("diagnostics.status", undefined),
                { signal }
              )
          )
          .toStrictEqual({ started: 1, interrupted: 1 });
      });
      const status = yield* Effect.promise(async () => {
        const response = await fetch(`${server.url}/api/diagnostics/status`);
        const json: unknown = await response.json();
        return json;
      });
      expect(
        yield* Schema.decodeUnknownEffect(DiagnosticStatus)(status)
      ).toStrictEqual({
        started: 1,
        interrupted: 1,
      });
    })
  );

  it.effect(
    "enforces HTTP body limits, schema validation, and exact mounts",
    () =>
      Effect.gen(function* enforceHttpMountsAndLimits() {
        const handler = yield* makeExampleWebHandler();
        for (const path of [
          "/apiary/users",
          "/%61pi/users",
          "/api/users/1/extra",
          "/rpc",
        ]) {
          const response = yield* Effect.promise(
            async () => await handler(new Request(`http://localhost${path}`))
          );
          expect(response.status).toBe(404);
        }
        const oversized = yield* Effect.promise(
          async () =>
            await handler(
              new Request("http://localhost/api/users", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "a".repeat(1024 * 1024) }),
              })
            )
        );
        expect(oversized.status).toBe(413);
        const invalid = yield* Effect.promise(
          async () =>
            await handler(
              new Request(
                "http://localhost/api/users/page?cursor=-1&pageSize=0"
              )
            )
        );
        expect(invalid.status).toBe(400);
      })
  );

  it.effect(
    "provides HTTP preflight headers while preserving RPC methods",
    () =>
      Effect.gen(function* exposeHttpPreflight() {
        const server = yield* startExampleRpcServer();
        const http = yield* Effect.promise(
          async () =>
            await fetch(`${server.url}/api/users`, { method: "OPTIONS" })
        );
        expect(http.status).toBe(204);
        expect(http.headers.get("access-control-allow-origin")).toBe("*");
        expect(http.headers.get("access-control-allow-methods")).toBe(
          "GET,POST,DELETE,OPTIONS"
        );
        expect(http.headers.get("access-control-allow-headers")).toContain(
          "x-example-authorization"
        );
        const rpc = yield* Effect.promise(
          async () => await fetch(server.rpcUrl, { method: "OPTIONS" })
        );
        expect(rpc.headers.get("access-control-allow-methods")).toBe(
          "POST,OPTIONS"
        );
      })
  );

  it.live(
    "keeps command workers alive until the caller closes the server Scope",
    () =>
      Effect.gen(function* retainCommandWorkers() {
        const server = yield* startExampleRpcServer();
        const rpc = yield* makeExampleRpcClient(server.rpcUrl);
        expect(
          yield* rpc("commands.start", {
            operationId: "shared-domain-scope",
            steps: 1,
          })
        ).toMatchObject({
          state: "completed",
          completedSteps: 1,
        });
      })
  );

  it.live("closes an in-flight HTTP request when the server Scope closes", () =>
    Effect.gen(function* closeActiveHttpRequest() {
      const owner = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(owner, Exit.void));
      const server = yield* startExampleRpcServer().pipe(Scope.provide(owner));
      const client = yield* HttpApiClient.make(exampleHttpApi, {
        baseUrl: server.url,
      }).pipe(Effect.provide(FetchHttpClient.layer));
      const context = yield* Effect.context();
      const pending = fetch(
        `${server.url}/api/diagnostics/slow?durationMs=60000&operationId=http-dispose`
      ).then(
        () => "completed",
        () => "closed"
      );
      yield* Effect.promise(async () => {
        await expect
          .poll(
            async ({ signal }) =>
              await Effect.runPromiseWith(context)(
                client.diagnostics.status(),
                {
                  signal,
                }
              )
          )
          .toMatchObject({ started: 1 });
      });
      yield* Scope.close(owner, Exit.void);
      expect(yield* Effect.promise(async () => await pending)).toBe("closed");
      yield* Effect.promise(async () => {
        await expect(fetch(`${server.url}/health`)).rejects.toThrow(
          "fetch failed"
        );
      });
    })
  );

  it.live("reports no activity for an unused diagnostic operation", () =>
    Effect.gen(function* unusedDiagnosticOperation() {
      const server = yield* startExampleRpcServer();
      const response = yield* Effect.promise(
        async () =>
          await fetch(`${server.url}/api/diagnostics/operations/unused`)
      );
      const json: unknown = yield* Effect.promise(async () => {
        const value: unknown = await response.json();
        return value;
      });
      expect(
        yield* Schema.decodeUnknownEffect(DiagnosticStatus)(json)
      ).toStrictEqual({
        started: 0,
        interrupted: 0,
      });
    })
  );

  it.live(
    "tracks and cancels simultaneous RPC and HTTP diagnostic operations independently",
    () =>
      Effect.gen(function* cancelIndependentDiagnostics() {
        const server = yield* startExampleRpcServer();
        const rpc = yield* makeExampleRpcClient(server.rpcUrl);
        const readStatus = async (
          id: string,
          signal: AbortSignal | null = null
        ) => {
          const response = await fetch(
            `${server.url}/api/diagnostics/operations/${id}`,
            { signal }
          );
          const json: unknown = await response.json();
          return Schema.decodeUnknownSync(DiagnosticStatus)(json);
        };
        const rpcSlow = yield* rpc("diagnostics.slow", {
          durationMs: 60_000,
          operationId: "rpc-panel",
        }).pipe(Effect.forkChild);
        // @effect-diagnostics-next-line abortControllerInEffect:off
        const controller = new AbortController();
        const httpSlow = fetch(
          `${server.url}/api/diagnostics/slow?durationMs=60000&operationId=http-panel`,
          {
            signal: controller.signal,
          }
        ).then(
          () => "completed",
          () => "aborted"
        );
        yield* Effect.promise(async () => {
          await expect
            .poll(async ({ signal }) => ({
              rpc: await readStatus("rpc-panel", signal),
              http: await readStatus("http-panel", signal),
            }))
            .toStrictEqual({
              rpc: { started: 1, interrupted: 0 },
              http: { started: 1, interrupted: 0 },
            });
        });
        yield* rpc("diagnostics.cancel", { operationId: "rpc-panel" });
        expect({
          rpcFailed: Exit.isFailure(yield* Fiber.await(rpcSlow)),
          rpc: yield* rpc("diagnostics.operationStatus", {
            operationId: "rpc-panel",
          }),
          http: yield* Effect.promise(
            async () => await readStatus("http-panel")
          ),
        }).toStrictEqual({
          rpcFailed: true,
          rpc: { started: 1, interrupted: 1 },
          http: { started: 1, interrupted: 0 },
        });
        controller.abort();
        expect(yield* Effect.promise(async () => await httpSlow)).toBe(
          "aborted"
        );
        yield* Effect.promise(async () => {
          await expect
            .poll(async ({ signal }) => await readStatus("http-panel", signal))
            .toStrictEqual({ started: 1, interrupted: 1 });
        });
        // oxlint-disable-next-line unicorn/no-useless-undefined
        const beforeReset = yield* rpc("diagnostics.status", undefined);
        // oxlint-disable-next-line unicorn/no-useless-undefined
        yield* rpc("testing.reset", undefined);
        expect({
          beforeReset,
          afterReset: yield* Effect.promise(
            async () => await readStatus("rpc-panel")
          ),
        }).toStrictEqual({
          beforeReset: { started: 2, interrupted: 2 },
          afterReset: { started: 0, interrupted: 0 },
        });
      })
  );
});
