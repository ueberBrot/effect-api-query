import { randomUUID } from "node:crypto";

import {
  DiagnosticOperationStatus,
  DiagnosticStatus,
  exampleHttpApi,
  User,
  SeedUser,
} from "@effect-api-query/contracts";
import { makeExampleRpcClient } from "@effect-api-query/contracts/client";
import { startExampleRpcServer } from "@effect-api-query/server";
import { makeExampleWebHandler } from "@effect-api-query/server/web-handler";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Schema, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { startExampleServerFixture } from "./fixtures/example-server.ts";
import { openOperationSession } from "./fixtures/operation-session.ts";

describe("example HTTP API", () => {
  it.effect(
    "shares user state with RPC and returns no content after deletion",
    () =>
      Effect.gen(function* shareRpcHttpUserState() {
        const writeToken = randomUUID();
        const server = yield* startExampleRpcServer({ writeToken });
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
        const user = yield* Schema.decodeUnknownEffect(User)(createdJson);
        expect(user).toMatchObject({
          id: 13,
          locale: "en",
          name: "Grace Hopper",
        });
        expect(yield* rpc["users.get"]({ id: 13 })).toMatchObject({
          name: "Grace Hopper",
        });
        const removed = yield* Effect.promise(
          async () =>
            await fetch(
              `${server.url}/api/users/13?revision=${user.revision}`,
              {
                method: "DELETE",
                headers: { authorization: `Bearer ${writeToken}` },
              }
            )
        );
        expect({
          status: removed.status,
          body: yield* Effect.promise(async () => await removed.text()),
        }).toStrictEqual({ status: 204, body: "" });
        expect(yield* Effect.flip(rpc["users.get"]({ id: 13 }))).toBe(
          "user-not-found"
        );
      })
  );

  it.effect("rejects a previous record revision through both transports", () =>
    Effect.gen(function* rejectStaleDirectoryDeletion() {
      const { server, seed, writeToken } = yield* startExampleServerFixture();
      const rpc = yield* makeExampleRpcClient(server.rpcUrl);
      const http = yield* HttpApiClient.make(exampleHttpApi, {
        baseUrl: server.url,
      }).pipe(Effect.provide(FetchHttpClient.layer));
      const headers = { authorization: `Bearer ${writeToken}` };
      const users = [new SeedUser({ name: "Grace Hopper" })];
      yield* seed({ users });
      const { id, revision } = yield* rpc["users.get"]({ id: 1 });
      yield* seed({ users });
      const replacement = yield* http.users.get({ params: { id }, query: {} });
      expect(replacement.revision).not.toBe(revision);

      const staleHttp = { params: { id }, query: { revision } };
      const staleRpc = { id, revision };
      expect(
        yield* Effect.flip(rpc["users.delete"](staleRpc)).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { headers })
        )
      ).toBe("user-not-found");
      expect(
        yield* Effect.flip(http.users.delete(staleHttp)).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { headers })
        )
      ).toBe("user-not-found");
      expect({
        http: yield* http.users.list(),
        rpc: yield* rpc["users.get"]({ id }),
      }).toStrictEqual({ http: [replacement], rpc: replacement });

      yield* http.users
        .delete({
          params: { id },
          query: { revision: replacement.revision },
        })
        .pipe(Effect.provideService(FetchHttpClient.RequestInit, { headers }));
      expect(yield* Effect.flip(rpc["users.get"]({ id }))).toBe(
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
      ).toMatchObject({ id: 1, locale: "de", name: "Ada Lovelace" });
      expect(
        yield* client.users.page({ query: { cursor: 10, pageSize: 5 } })
      ).toMatchObject({
        nextCursor: null,
        total: 12,
        users: [
          { id: 11, locale: "en", name: "Annie Easley" },
          { id: 12, locale: "en", name: "James Gosling" },
        ],
      });
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
      const { revision } = yield* client.users.get({
        params: { id: 1 },
        query: {},
      });
      expect(
        yield* Effect.flip(
          client.users.delete({ params: { id: 1 }, query: { revision } })
        )
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
      const session = yield* Effect.promise(
        async () => await openOperationSession(server.url)
      );
      const rpc = yield* makeExampleRpcClient(server.rpcUrl, session.fetch);
      const context = yield* Effect.context();
      // @effect-diagnostics-next-line abortControllerInEffect:off
      const controller = new AbortController();
      const pending = session
        .fetch(
          `${server.url}/api/diagnostics/slow?durationMs=60000&operationId=http-abort`,
          {
            method: "POST",
            signal: controller.signal,
          }
        )
        .then(() => "completed")
        .catch(() => "aborted");
      yield* Effect.promise(async () => {
        await expect
          .poll(
            async ({ signal }) =>
              await Effect.runPromiseWith(context)(
                // oxlint-disable-next-line unicorn/no-useless-undefined
                rpc["diagnostics.status"](undefined),
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
                rpc["diagnostics.status"](undefined),
                { signal }
              )
          )
          .toStrictEqual({ started: 1, interrupted: 1 });
      });
      const status = yield* Effect.promise(async () => {
        const response = await session.fetch(
          `${server.url}/api/diagnostics/status`
        );
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
    "grants CORS only to configured origins and preserves route metadata",
    () =>
      Effect.gen(function* exposeHttpPreflight() {
        const origin = "http://127.0.0.1:5173";
        const otherAllowedOrigin = "https://example.com";
        const server = yield* startExampleRpcServer({
          allowedOrigins: [origin, otherAllowedOrigin],
        });
        const http = yield* Effect.promise(
          async () =>
            await fetch(`${server.httpApiUrl}/users`, {
              headers: {
                "access-control-request-headers": "authorization,if-match",
                "access-control-request-method": "DELETE",
                origin,
              },
              method: "OPTIONS",
            })
        );
        expect({
          methods: http.headers.get("access-control-allow-methods"),
          origin: http.headers.get("access-control-allow-origin"),
          status: http.status,
          vary: http.headers.get("vary"),
        }).toStrictEqual({
          methods: "GET,POST,DELETE,OPTIONS",
          origin,
          status: 204,
          vary: "Origin",
        });
        expect(http.headers.get("access-control-allow-headers")).toContain(
          "if-match"
        );
        const rpc = yield* Effect.promise(
          async () =>
            await fetch(server.rpcUrl, {
              headers: {
                "access-control-request-method": "POST",
                origin: otherAllowedOrigin,
              },
              method: "OPTIONS",
            })
        );
        expect({
          headers: rpc.headers.get("access-control-allow-headers"),
          methods: rpc.headers.get("access-control-allow-methods"),
          origin: rpc.headers.get("access-control-allow-origin"),
          status: rpc.status,
        }).toStrictEqual({
          headers: "authorization,baggage,content-type,traceparent,tracestate",
          methods: "POST,OPTIONS",
          origin: otherAllowedOrigin,
          status: 204,
        });
        for (const requestOrigin of [origin, `${origin}0`, undefined]) {
          const expectedOrigin = requestOrigin === origin ? origin : null;
          const headers =
            requestOrigin === undefined ? {} : { origin: requestOrigin };
          const response = yield* Effect.promise(
            async () => await fetch(`${server.httpApiUrl}/users`, { headers })
          );
          expect(response.status).toBe(200);
          expect(response.headers.get("access-control-allow-origin")).toBe(
            expectedOrigin
          );
          expect(response.headers.get("access-control-expose-headers")).toBe(
            expectedOrigin === null ? null : "etag"
          );
          expect(response.headers.get("vary")).toBe("Origin");
        }
        const denied = yield* Effect.promise(
          async () =>
            await fetch(server.rpcUrl, {
              headers: {
                "access-control-request-method": "POST",
                origin: "https://other.example",
              },
              method: "OPTIONS",
            })
        );
        expect({
          headers: denied.headers.get("access-control-allow-headers"),
          origin: denied.headers.get("access-control-allow-origin"),
          status: denied.status,
          vary: denied.headers.get("vary"),
        }).toStrictEqual({
          headers: null,
          origin: null,
          status: 204,
          vary: "Origin",
        });
      })
  );

  it.live("closes an in-flight HTTP request when the server Scope closes", () =>
    Effect.gen(function* closeActiveHttpRequest() {
      const owner = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(owner, Exit.void));
      const server = yield* startExampleRpcServer().pipe(Scope.provide(owner));
      const session = yield* Effect.promise(
        async () => await openOperationSession(server.url)
      );
      const client = yield* HttpApiClient.make(exampleHttpApi, {
        baseUrl: server.url,
      }).pipe(
        Effect.provide(
          FetchHttpClient.layer.pipe(
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, session.fetch))
          )
        )
      );
      const context = yield* Effect.context();
      const pending = session
        .fetch(
          `${server.url}/api/diagnostics/slow?durationMs=60000&operationId=http-dispose`,
          { method: "POST" }
        )
        .then(() => "completed")
        .catch(() => "closed");
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

  it.live("returns missing for an unused diagnostic operation", () =>
    Effect.gen(function* unusedDiagnosticOperation() {
      const server = yield* startExampleRpcServer();
      const session = yield* Effect.promise(
        async () => await openOperationSession(server.url)
      );
      const response = yield* Effect.promise(
        async () =>
          await session.fetch(`${server.url}/api/diagnostics/operations/unused`)
      );
      expect(response.status).toBe(404);
    })
  );

  it.live(
    "tracks and cancels simultaneous RPC and HTTP diagnostic operations independently",
    () =>
      Effect.gen(function* cancelIndependentDiagnostics() {
        const { server, reset } = yield* startExampleServerFixture();
        const session = yield* Effect.promise(
          async () => await openOperationSession(server.url)
        );
        const rpc = yield* makeExampleRpcClient(server.rpcUrl, session.fetch);
        const readStatus = async (
          id: string,
          signal: AbortSignal | null = null
        ) => {
          const response = await session.fetch(
            `${server.url}/api/diagnostics/operations/${id}`,
            { signal }
          );
          const json: unknown = await response.json();
          return Schema.decodeUnknownSync(DiagnosticOperationStatus)(json);
        };
        const rpcSlow = yield* rpc["diagnostics.slow"]({
          durationMs: 60_000,
          operationId: "rpc-panel",
        }).pipe(Effect.forkChild);
        // @effect-diagnostics-next-line abortControllerInEffect:off
        const controller = new AbortController();
        const httpSlow = session
          .fetch(
            `${server.url}/api/diagnostics/slow?durationMs=60000&operationId=http-panel`,
            {
              method: "POST",
              signal: controller.signal,
            }
          )
          .then(() => "completed")
          .catch(() => "aborted");
        yield* Effect.promise(async () => {
          await expect
            .poll(async ({ signal }) => ({
              rpc: await readStatus("rpc-panel", signal),
              http: await readStatus("http-panel", signal),
            }))
            .toStrictEqual({
              rpc: { started: 1, interrupted: 0, completed: 0 },
              http: { started: 1, interrupted: 0, completed: 0 },
            });
        });
        yield* rpc["diagnostics.cancel"]({ operationId: "rpc-panel" });
        expect({
          rpcFailed: Exit.isFailure(yield* Fiber.await(rpcSlow)),
          rpc: yield* rpc["diagnostics.operationStatus"]({
            operationId: "rpc-panel",
          }),
          http: yield* Effect.promise(
            async () => await readStatus("http-panel")
          ),
        }).toStrictEqual({
          rpcFailed: true,
          rpc: { started: 1, interrupted: 1, completed: 0 },
          http: { started: 1, interrupted: 0, completed: 0 },
        });
        controller.abort();
        expect(yield* Effect.promise(async () => await httpSlow)).toBe(
          "aborted"
        );
        yield* Effect.promise(async () => {
          await expect
            .poll(async ({ signal }) => await readStatus("http-panel", signal))
            .toStrictEqual({ started: 1, interrupted: 1, completed: 0 });
        });
        // oxlint-disable-next-line unicorn/no-useless-undefined
        const beforeReset = yield* rpc["diagnostics.status"](undefined);
        yield* reset;
        expect({
          beforeReset,
          // oxlint-disable-next-line unicorn/no-useless-undefined
          afterReset: yield* rpc["diagnostics.status"](undefined),
        }).toStrictEqual({
          beforeReset: { started: 2, interrupted: 2 },
          afterReset: { started: 0, interrupted: 0 },
        });
      })
  );
});
