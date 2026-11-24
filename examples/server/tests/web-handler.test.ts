import { randomUUID } from "node:crypto";

import {
  makeExampleRpcWebHandler,
  makeExampleWebHandler,
} from "@effect-api-query/server/web-handler";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

const streamingRequest = (
  url: string,
  init: RequestInit & { readonly duplex?: "half" }
) => new Request(url, init);

describe("example RPC request body limit", () => {
  it.effect(
    "rejects failed and aborted uploads without waiting for more bytes",
    () =>
      Effect.gen(function* rejectFailedUploads() {
        const handler = yield* makeExampleRpcWebHandler();
        const failed = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("Upload failed"));
          },
        });
        const failedResponse = yield* Effect.promise(
          async () =>
            await handler(
              streamingRequest("http://localhost/rpc", {
                method: "POST",
                body: failed,
                duplex: "half",
              })
            )
        );
        expect(failedResponse.status).toBe(400);

        // @effect-diagnostics-next-line abortControllerInEffect:off
        const controller = new AbortController();
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        });
        const response = handler(
          streamingRequest("http://localhost/rpc", {
            method: "POST",
            body,
            signal: controller.signal,
            duplex: "half",
          })
        );
        controller.abort();
        expect((yield* Effect.promise(async () => await response)).status).toBe(
          400
        );
        expect(cancelled).toBe(true);
      })
  );

  it.effect("accepts bodies up to one MiB and rejects the next byte", () =>
    Effect.gen(function* enforceBodyByteBoundary() {
      const handler = yield* makeExampleRpcWebHandler();
      for (const size of [1024 * 1024 - 1, 1024 * 1024, 1024 * 1024 + 1]) {
        const response = yield* Effect.promise(
          async () =>
            await handler(
              streamingRequest("http://localhost/rpc", {
                method: "POST",
                body: "[]".padEnd(size),
              })
            )
        );
        expect(response.status).toBe(size > 1024 * 1024 ? 413 : 200);
        yield* Effect.promise(async () => await response.arrayBuffer());
      }
    })
  );

  it.effect(
    "preserves earlier upload bytes when a producer reuses its chunk buffer",
    () =>
      Effect.gen(function* retainReusedChunkBytes() {
        const handler = yield* makeExampleRpcWebHandler();
        const bytes = new Uint8Array(1024);
        let chunks = 0;
        const body = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (chunks === 5) {
                controller.close();
                return;
              }
              bytes.fill(32);
              if (chunks === 0) {
                bytes.set(new TextEncoder().encode("[]"));
              }
              controller.enqueue(bytes);
              chunks += 1;
            },
          },
          { highWaterMark: 0 }
        );
        const response = yield* Effect.promise(
          async () =>
            await handler(
              streamingRequest("http://localhost/rpc", {
                method: "POST",
                body,
                duplex: "half",
              })
            )
        );
        expect(response.status).toBe(200);
        yield* Effect.promise(async () => await response.arrayBuffer());
      })
  );

  it.effect(
    "counts streamed bytes despite missing or misleading lengths and cancels overflow",
    () =>
      Effect.gen(function* countStreamedUploadBytes() {
        const handler = yield* makeExampleRpcWebHandler();
        for (const headers of [{}, { "content-length": "2" }]) {
          let cancelled = false;
          const body = new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(
                new TextEncoder().encode("é".repeat(128 * 1024))
              );
            },
            cancel() {
              cancelled = true;
            },
          });
          const response = yield* Effect.promise(
            async () =>
              await handler(
                streamingRequest("http://localhost/rpc", {
                  method: "POST",
                  body,
                  headers,
                  duplex: "half",
                })
              )
          );
          expect(response.status).toBe(413);
          expect(cancelled).toBe(true);
        }
      })
  );
});

describe("verified demo write sessions", () => {
  it.effect("allows same-origin writes until the issued session expires", () =>
    Effect.gen(function* verifySession() {
      const writeToken = randomUUID();
      // oxlint-disable-next-line unicorn/no-useless-undefined
      const handle = yield* makeExampleWebHandler(undefined, writeToken);
      const origin = "https://example.test";
      const issued = yield* Effect.promise(
        async () =>
          await handle(
            new Request(`${origin}/api/demo-access`, {
              method: "POST",
              headers: { origin, authorization: `Bearer ${writeToken}` },
            })
          )
      );
      expect(issued.status).toBe(204);
      const cookie = issued.headers.get("set-cookie");
      expect(cookie).toMatch(
        /; HttpOnly; SameSite=Strict; Max-Age=3600; Secure$/u
      );
      if (cookie === null) {
        throw new Error("The host did not issue a session");
      }
      const remove = (id: number, requestOrigin: string) =>
        Effect.promise(
          async () =>
            await handle(
              new Request(`${origin}/api/users/${String(id)}`, {
                method: "DELETE",
                headers: {
                  origin: requestOrigin,
                  cookie: cookie.split(";")[0] ?? "",
                },
              })
            )
        );
      const crossOrigin = yield* remove(1, "https://other.example.test");
      expect(crossOrigin.status).toBe(401);
      const authorized = yield* remove(1, origin);
      expect(authorized.status).toBe(204);

      yield* TestClock.adjust("1 hour");
      const expired = yield* remove(2, origin);
      expect(expired.status).toBe(401);
    })
  );
});
