import { describe, it } from "@effect/vitest";
import { CancelledError, QueryClient } from "@tanstack/query-core";
import { Deferred, Effect, Layer, Schema, Stream } from "effect";
import { HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from "effect/http-api";
import { expect } from "vite-plus/test";

import {
  configureUtils,
  createHttpApiQueryUtils,
  EffectHttpApiQueryEmptyStreamError,
} from "#effect-api-query";

import { captureFailure } from "./fixtures/async";

const api = HttpApi.make("empty-live").add(
  HttpApiGroup.make("events").add(
    HttpApiEndpoint.get("watch", "/watch", {
      success: HttpApiSchema.StreamSse({ data: Schema.Finite }),
    })
  )
);
const handlers = HttpApiBuilder.group(api, "events", (group) =>
  group.handle("watch", () => Effect.succeed(Stream.empty))
);

describe.each([
  { label: "uncoalesced", coalesceMs: undefined },
  { label: "coalesced", coalesceMs: 100 },
] as const)("HTTP live queries ($label)", ({ coalesceMs }) => {
  it.effect(
    "reports declaration identity when an HTTP live stream completes without an event",
    () =>
      Effect.gen(function* reportEmptyHttpLiveStream() {
        const client = yield* HttpApiTest.groups(api, ["events"]);
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["test", coalesceMs ?? "none"],
        });
        expect(http.events.watch).not.toHaveProperty("call");
        expect(http.events.watch).not.toHaveProperty("effect");
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        try {
          yield* Effect.promise(async () => {
            const pending = queryClient.query(
              http.events.watch.liveOptions(
                coalesceMs === undefined ? undefined : { coalesceMs }
              )
            );
            await expect(pending).rejects.toBeInstanceOf(
              EffectHttpApiQueryEmptyStreamError
            );
            await expect(pending).rejects.toMatchObject({
              _tag: "EffectHttpApiQueryEmptyStreamError",
              apiId: "empty-live",
              groupId: "events",
              endpoint: "watch",
              method: "GET",
              operation: "live",
            });
          });
        } finally {
          queryClient.clear();
        }
      }).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.scoped
      )
  );

  it.effect(
    "settles cleanly when aborted before its first emission without throwing an empty-stream error",
    () =>
      Effect.gen(function* abortHttpLiveBeforeFirstEmission() {
        const started = yield* Deferred.make<boolean>();
        const finalized = yield* Deferred.make<boolean>();
        const pendingHandlers = HttpApiBuilder.group(api, "events", (group) =>
          group.handle("watch", () =>
            Effect.succeed(
              Stream.fromEffect(
                Deferred.succeed(started, true).pipe(
                  Effect.andThen(Effect.never)
                )
              ).pipe(Stream.ensuring(Deferred.succeed(finalized, true)))
            )
          )
        );
        const client = yield* HttpApiTest.groups(api, ["events"]).pipe(
          Effect.provide(
            Layer.mergeAll(pendingHandlers, HttpServer.layerServices)
          )
        );
        let executionError: unknown;
        let executionSettled = false;
        const executionDone = yield* Deferred.make<boolean>();
        const runPromise = Effect.runPromiseWith(yield* Effect.context());
        const http = configureUtils(
          createHttpApiQueryUtils(api, {
            client,
            keyPrefix: ["abort-http-live", coalesceMs ?? "none"],
          }),
          {
            live: {
              interceptors: [
                async ({ next }) => {
                  try {
                    return await next();
                  } catch (error) {
                    executionError = error;
                    throw error;
                  } finally {
                    executionSettled = true;
                    await runPromise(Deferred.succeed(executionDone, true));
                  }
                },
              ],
            },
          }
        );
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        const options = http.events.watch.liveOptions(
          coalesceMs === undefined ? undefined : { coalesceMs }
        );
        try {
          const pending = queryClient.query(options);
          yield* Deferred.await(started);
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries({ queryKey: options.queryKey });
          });
          const queryError = yield* Effect.promise(
            async () => await captureFailure(pending)
          );
          yield* Deferred.await(finalized);
          yield* Deferred.await(executionDone);
          expect(queryError).toBeInstanceOf(CancelledError);
          expect(executionSettled).toBe(true);
          expect(executionError).toBeUndefined();
          expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
        } finally {
          queryClient.clear();
        }
      }).pipe(Effect.scoped)
  );
});
