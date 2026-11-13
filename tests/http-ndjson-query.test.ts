import { it } from "@effect/vitest";
import { QueryClient } from "@tanstack/query-core";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Schema,
  SchemaTransformation,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { describe, expect } from "vite-plus/test";

import {
  configureUtils,
  createHttpApiQueryUtils,
  fetchStreamSnapshot,
  isEffectHttpApiQueryError,
} from "#effect-api-query";

import { captureFailure } from "./fixtures/async.ts";
import { waitForQueryState } from "./fixtures/query-cache.ts";

const Record = Schema.Struct({ id: Schema.FiniteFromString });
class RecordScale extends Context.Service<
  RecordScale,
  { readonly factor: number }
>()("Ndjson/RecordScale") {}
const api = HttpApi.make("ndjson-views").add(
  HttpApiGroup.make("records").add(
    HttpApiEndpoint.get("watch", "/watch", {
      query: { channel: Schema.String },
      success: HttpApiSchema.StreamNdjson({
        schema: Record,
        maxElementBytes: 64,
      }),
    }),
    HttpApiEndpoint.get("wrapped", "/wrapped", {
      success: HttpApiSchema.WithHeaders(
        HttpApiSchema.StreamNdjson({ schema: Record }),
        { "x-version": Schema.FiniteFromString }
      ),
    })
  )
);

const ndjson = (chunks: readonly string[], headers = {}) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "application/x-ndjson", ...headers } }
  );
const makeClient = (response: () => Response) =>
  HttpApiClient.makeWith(api, {
    baseUrl: "https://example.test",
    httpClient: HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, response()))
    ),
  });

it.effect(
  "uses the caller's decoding services for NDJSON records and headers",
  () =>
    Effect.gen(function* decodeNdjsonWithServices() {
      const Scaled = Schema.FiniteFromString.pipe(
        Schema.decodeTo(
          Schema.Finite,
          SchemaTransformation.transformEffect({
            decode: (value) =>
              RecordScale.pipe(Effect.map(({ factor }) => value * factor)),
            encode: Effect.succeed,
          })
        )
      );
      const serviceApi = HttpApi.make("ndjson-services").add(
        HttpApiGroup.make("records").add(
          HttpApiEndpoint.get("watch", "/watch", {
            success: HttpApiSchema.WithHeaders(
              HttpApiSchema.StreamNdjson({
                schema: Schema.Struct({ id: Scaled }),
              }),
              { "x-version": Scaled }
            ),
          })
        )
      );
      const client = yield* HttpApiClient.makeWith(serviceApi, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              ndjson(['{"id":"2"}\n'], { "x-version": "4" })
            )
          )
        ),
      });
      const http = createHttpApiQueryUtils(serviceApi, {
        client,
        keyPrefix: ["services"],
        runPromiseExit: Effect.runPromiseExitWith(
          Context.make(RecordScale, { factor: 3 })
        ),
      });
      const queryClient = new QueryClient();
      try {
        expect(
          yield* Effect.promise(
            async () =>
              await queryClient.query(http.records.watch.liveOptions())
          )
        ).toStrictEqual(
          HttpApiSchema.withHeaders({
            body: { id: 6 },
            headers: { "x-version": 12 },
          })
        );
      } finally {
        queryClient.clear();
      }
    })
);

it.effect("preserves decoded NDJSON header wrappers in both views", () =>
  Effect.gen(function* preserveNdjsonHeaders() {
    const client = yield* makeClient(() =>
      ndjson(['{"id":"1"}\n', '{"id":"2"}\n'], { "x-version": "4" })
    );
    const http = createHttpApiQueryUtils(api, {
      client,
      keyPrefix: ["headers"],
    });
    const queryClient = new QueryClient();
    try {
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(
              http.records.wrapped.streamedOptions({ maxChunks: "unbounded" })
            )
        )
      ).toStrictEqual([
        HttpApiSchema.withHeaders({
          body: { id: 1 },
          headers: { "x-version": 4 },
        }),
        HttpApiSchema.withHeaders({
          body: { id: 2 },
          headers: { "x-version": 4 },
        }),
      ]);
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(http.records.wrapped.liveOptions())
        )
      ).toStrictEqual(
        HttpApiSchema.withHeaders({
          body: { id: 2 },
          headers: { "x-version": 4 },
        })
      );
    } finally {
      queryClient.clear();
    }
  })
);

describe.each(
  (["live", "streamed"] as const).flatMap((view) =>
    [
      { body: "{broken}\n", tag: "SchemaError" },
      { body: '{"id":"invalid"}\n', tag: "SchemaError" },
      { body: `{"id":"${"1".repeat(70)}"}\n`, tag: "HttpClientError" },
    ].map((failure) => ({ view, ...failure }))
  )
)(
  "preserves NDJSON $view decoding failures for $body",
  ({ view, body, tag }) => {
    it.effect("preserves the failure and already published records", () =>
      Effect.gen(function* preserveNdjsonFailures() {
        const client = yield* makeClient(() =>
          ndjson(['{"id":"1"}\n', '{"id":"2"}\n', body])
        );
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["decode", view, tag],
        });
        const input = { query: { channel: "news" } };
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        const options =
          view === "live"
            ? http.records.watch.liveOptions({ input })
            : http.records.watch.streamedOptions({
                input,
                maxChunks: 2,
                publicationBatchSize: 3,
              });
        try {
          const error = yield* Effect.promise(
            async () =>
              await captureFailure(
                view === "live"
                  ? queryClient.query(http.records.watch.liveOptions({ input }))
                  : queryClient.query(
                      http.records.watch.streamedOptions({
                        input,
                        maxChunks: 2,
                        publicationBatchSize: 3,
                      })
                    )
              )
          );
          expect(error).toMatchObject({
            _tag: "EffectHttpApiQueryError",
            apiId: "ndjson-views",
            endpoint: "watch",
            operation: view,
          });
          if (!isEffectHttpApiQueryError(error)) {
            throw new TypeError("Expected an HTTP execution error");
          }
          expect(error.cause.reasons[0]).toMatchObject({
            _tag: "Fail",
            error: { _tag: tag },
          });
          expect(queryClient.getQueryData(options.queryKey)).toStrictEqual(
            view === "live" ? { id: 2 } : [{ id: 1 }, { id: 2 }]
          );
        } finally {
          queryClient.clear();
        }
      })
    );
  }
);

it.effect(
  "keeps NDJSON empty completion distinct from an empty live query",
  () =>
    Effect.gen(function* completeEmptyNdjson() {
      const client = yield* makeClient(() => ndjson([]));
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["empty"],
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const input = { query: { channel: "empty" } };
      try {
        expect(
          yield* Effect.promise(
            async () =>
              await queryClient.query(
                http.records.watch.streamedOptions({ input, maxChunks: 2 })
              )
          )
        ).toStrictEqual([]);
        const error = yield* Effect.promise(
          async () =>
            await captureFailure(
              queryClient.query(http.records.watch.liveOptions({ input }))
            )
        );
        expect(error).toMatchObject({
          _tag: "EffectHttpApiQueryEmptyStreamError",
          apiId: "ndjson-views",
          groupId: "records",
          endpoint: "watch",
          operation: "live",
        });
      } finally {
        queryClient.clear();
      }
    })
);

describe.each(["reset", "append", "replace"] as const)(
  "retains configured NDJSON %s histories",
  (refetchMode) => {
    it.effect(
      "publishes bounded refetch history through native QueryClient",
      () =>
        Effect.gen(function* retainNdjsonHistory() {
          let calls = 0;
          const client = yield* makeClient(() => {
            calls += 1;
            return ndjson(
              calls === 1 ? ['{"id":"1"}\n{"id":"2"}\n'] : ['{"id":"3"}\n']
            );
          });
          const http = configureUtils(
            createHttpApiQueryUtils(api, { client, keyPrefix: ["retention"] }),
            {
              streamed: {
                policy: { maxChunks: 2, refetchMode, publicationBatchSize: 2 },
              },
            }
          );
          const input = { query: { channel: "news" } };
          const options = http.records.watch.streamedOptions({ input });
          const queryClient = new QueryClient();
          const publications: unknown[] = [];
          try {
            yield* Effect.promise(async () => await queryClient.query(options));
            const stop = queryClient.getQueryCache().subscribe((event) => {
              if (event.type === "updated" && event.action.type === "success") {
                publications.push(event.query.state.data);
              }
            });
            try {
              const result = yield* Effect.promise(
                async () => await queryClient.query(options)
              );
              const expected =
                refetchMode === "append" ? [{ id: 2 }, { id: 3 }] : [{ id: 3 }];
              expect(result).toStrictEqual(expected);
              expect(
                queryClient.getQueryData(http.records.watch.streamedKey(input))
              ).toStrictEqual(expected);
              expect(publications).toContainEqual(expected);
            } finally {
              stop();
            }
          } finally {
            queryClient.clear();
          }
        })
    );
  }
);

describe.each(
  (["live", "streamed"] as const).flatMap((view) =>
    (["cancel", "snapshot"] as const).map((mode) => ({ view, mode }))
  )
)("closes an open NDJSON $view view through $mode", ({ view, mode }) => {
  it.effect("closes the body and drains snapshot cleanup", () =>
    Effect.gen(function* closeNdjsonBody() {
      const runPromise = Effect.runPromiseWith(yield* Effect.context());
      const closing = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const finalized = yield* Deferred.make<boolean>();
      const aborted = yield* Deferred.make<boolean>();
      let transportSignal: AbortSignal | undefined;
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request, _url, signal) => {
          transportSignal = signal;
          signal.addEventListener(
            "abort",
            () => {
              Deferred.doneUnsafe(aborted, Exit.succeed(true));
            },
            { once: true }
          );
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(
                      new TextEncoder().encode('{"id":"1"}\n')
                    );
                  },
                  async cancel() {
                    Deferred.doneUnsafe(closing, Exit.succeed(true));
                    await runPromise(Deferred.await(release));
                    Deferred.doneUnsafe(finalized, Exit.succeed(true));
                  },
                }),
                { headers: { "content-type": "application/x-ndjson" } }
              )
            )
          );
        }),
      });
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["cleanup", view, mode],
      });
      const input = { query: { channel: "news" } };
      const liveOptions = http.records.watch.liveOptions({ input });
      const streamedOptions = http.records.watch.streamedOptions({
        input,
        maxChunks: 2,
      });
      const queryKey =
        view === "live" ? liveOptions.queryKey : streamedOptions.queryKey;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      let settled = false;
      let execution: Promise<unknown>;
      if (mode === "snapshot") {
        execution =
          view === "live"
            ? fetchStreamSnapshot(queryClient, liveOptions)
            : fetchStreamSnapshot(queryClient, streamedOptions);
      } else {
        execution =
          view === "live"
            ? queryClient.query(liveOptions)
            : queryClient.query(streamedOptions);
      }
      const pending = execution.then((data) => {
        settled = true;
        return data;
      });
      try {
        yield* waitForQueryState(
          queryClient,
          () => queryClient.getQueryState(queryKey)?.status === "success"
        );
        if (mode === "cancel") {
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries({ queryKey, exact: true });
          });
        }
        yield* Deferred.await(closing);
        expect(Deferred.isDoneUnsafe(finalized)).toBe(false);
        if (mode === "snapshot") {
          expect(settled).toBe(false);
        }
        yield* Deferred.succeed(release, true);
        yield* Deferred.await(finalized);
        expect(yield* Effect.promise(async () => await pending)).toStrictEqual(
          view === "live" ? { id: 1 } : [{ id: 1 }]
        );
        yield* Deferred.await(aborted);
        expect(transportSignal?.aborted).toBe(true);
      } finally {
        yield* Deferred.succeed(release, true);
        yield* Effect.promise(async () => {
          await queryClient.cancelQueries();
        });
        queryClient.clear();
      }
    })
  );
});
it.effect("caches decoded NDJSON records in accumulated and live views", () =>
  Effect.gen(function* cacheDecodedNdjson() {
    const client = yield* makeClient(() =>
      ndjson(['{"id":"1"}\n{"i', 'd":"2"}\n\n{"id":"3"}'])
    );
    const http = createHttpApiQueryUtils(api, {
      client,
      keyPrefix: ["ndjson"],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const input = { query: { channel: "news" } };
    try {
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(
              http.records.watch.streamedOptions({ input, maxChunks: 2 })
            )
        )
      ).toStrictEqual([{ id: 2 }, { id: 3 }]);
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(http.records.watch.liveOptions({ input }))
        )
      ).toStrictEqual({ id: 3 });
      expect(
        http.records.watch.streamedKey(input, { maxChunks: 2 })
      ).toStrictEqual([
        ...http.records.watch.key(),
        "streamed",
        { query: { channel: "news" } },
        { maxChunks: 2, refetchMode: "reset" },
      ]);
      expect(http.records.watch.liveKey(input)).toStrictEqual([
        ...http.records.watch.key(),
        "live",
        { query: { channel: "news" } },
        {},
      ]);
    } finally {
      queryClient.clear();
    }
  })
);

it.effect(
  "coalesces configured NDJSON snapshots with local key policy overrides",
  () =>
    Effect.gen(function* configuredNdjsonCoalescing() {
      const client = yield* makeClient(() =>
        ndjson(['{"id":"1"}\n{"id":"2"}\n{"id":"3"}\n'])
      );
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["coalesced"],
      });
      const leaf = http.records.watch;
      const configured = configureUtils(leaf, {
        live: { policy: { coalesceMs: 1000 } },
      });
      const input = { query: { channel: "news" } };
      const queryClient = new QueryClient();
      const publications: unknown[] = [];
      const stop = queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "success" &&
          event.action.manual === true
        ) {
          publications.push(event.query.state.data);
        }
      });
      try {
        const options = configured.liveOptions({ input });
        const result = yield* Effect.promise(
          async () => await queryClient.query(options)
        );
        expect({
          key: options.queryKey,
          configuredKey: configured.liveKey(input),
          result,
          publications,
          cached: queryClient.getQueryData(configured.liveKey(input)),
        }).toStrictEqual({
          key: leaf.liveKey(input, { coalesceMs: 1000 }),
          configuredKey: leaf.liveKey(input, { coalesceMs: 1000 }),
          result: { id: 3 },
          publications: [{ id: 1 }, { id: 3 }],
          cached: { id: 3 },
        });
        expect(options.queryKey).not.toStrictEqual(leaf.liveKey(input));
        publications.length = 0;
        const local = configured.liveOptions({ input, coalesceMs: undefined });
        const localResult = yield* Effect.promise(
          async () => await queryClient.query(local)
        );
        expect({
          key: local.queryKey,
          configuredKey: configured.liveKey(input, { coalesceMs: undefined }),
          result: localResult,
          publications,
          original: queryClient.getQueryData(options.queryKey),
        }).toStrictEqual({
          key: leaf.liveKey(input),
          configuredKey: leaf.liveKey(input),
          result: { id: 3 },
          publications: [{ id: 1 }, { id: 2 }, { id: 3 }],
          original: { id: 3 },
        });
      } finally {
        stop();
        queryClient.clear();
      }
    })
);
