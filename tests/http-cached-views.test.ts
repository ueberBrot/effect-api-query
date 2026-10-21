import { it } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Predicate,
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
  createHttpApiQueryUtils,
  isEffectHttpApiQueryError,
  skipToken,
} from "#effect-api-query";

import { captureFailure } from "./fixtures/async.ts";
import { waitForQueryState } from "./fixtures/query-cache.ts";

const UndefinedValue = Schema.Null.pipe(
  Schema.decodeTo(
    Schema.Void,
    SchemaTransformation.transform({ decode: () => {}, encode: () => null })
  )
);
const api = HttpApi.make("cached-views").add(
  HttpApiGroup.make("items").add(
    HttpApiEndpoint.get("watch", "/watch", {
      success: HttpApiSchema.StreamSse({
        data: Schema.Union([Schema.Int, UndefinedValue]),
      }),
    }),
    HttpApiEndpoint.get("wrapped", "/wrapped", {
      success: HttpApiSchema.WithHeaders(
        HttpApiSchema.StreamSse({ data: Schema.Int }),
        {
          "x-version": Schema.FiniteFromString,
        }
      ),
    }),
    HttpApiEndpoint.get("read", "/read", {
      success: HttpApiSchema.WithHeaders(Schema.String, {
        etag: Schema.String,
      }).pipe(HttpApiSchema.status(203)),
    })
  )
);
const makeClient = (response: () => Response) =>
  HttpApiClient.makeWith(api, {
    baseUrl: "https://example.test",
    httpClient: HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, response()))
    ),
  });
const sse = (body: string, headers = {}) =>
  new Response(body, {
    headers: { "content-type": "text/event-stream", ...headers },
  });

it.effect(
  "caches decoded SSE views and preserves declared header wrappers",
  () =>
    Effect.gen(function* cacheDecodedSseViews() {
      const client = yield* makeClient(() =>
        sse("data: 1\n\ndata: null\n\n", { "x-version": "4" })
      );
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["views"],
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          queryClient.clear();
        })
      );
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(http.items.watch.streamedOptions())
        )
      ).toStrictEqual([1, undefined]);
      expect(
        yield* Effect.promise(
          async () => await queryClient.query(http.items.watch.liveOptions())
        )
      ).toBeNull();
      const wrapped = yield* makeClient(() =>
        sse("data: 3\n\ndata: 7\n\n", { "x-version": "4" })
      );
      const wrappedHttp = createHttpApiQueryUtils(api, {
        client: wrapped,
        keyPrefix: ["wrapped"],
      });
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(wrappedHttp.items.wrapped.streamedOptions())
        )
      ).toStrictEqual([
        HttpApiSchema.withHeaders({ body: 3, headers: { "x-version": 4 } }),
        HttpApiSchema.withHeaders({ body: 7, headers: { "x-version": 4 } }),
      ]);
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(wrappedHttp.items.wrapped.liveOptions())
        )
      ).toStrictEqual(
        HttpApiSchema.withHeaders({ body: 7, headers: { "x-version": 4 } })
      );
    })
);

it.effect("normalizes HTTP SSE decoder policies in cache keys", () =>
  Effect.gen(function* normalizeSseDecoderKeys() {
    const client = yield* makeClient(() => sse("data: 1\n\n"));
    const http = createHttpApiQueryUtils(api, {
      client,
      keyPrefix: ["decoder-keys"],
    });
    expect(http.items.watch.streamedKey()).toStrictEqual(
      http.items.watch.streamedKey({
        sseOptions: { maxEventSize: 10 * 1024 * 1024 },
      })
    );
    expect(http.items.watch.streamedKey()).not.toStrictEqual(
      http.items.watch.streamedKey({ sseOptions: { maxEventSize: 3 } })
    );
  })
);

it.effect(
  "preserves cached HTTP history when another decoder policy fails",
  () =>
    Effect.gen(function* preserveHistoryAfterDecoderFailure() {
      const client = yield* makeClient(() =>
        sse("data: 1\n\ndata: null\n\n", { "x-version": "4" })
      );
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["views"],
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          queryClient.clear();
        })
      );
      yield* Effect.promise(
        async () => await queryClient.query(http.items.watch.streamedOptions())
      );
      const decoderClient = yield* makeClient(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: 12345"));
                controller.enqueue(new TextEncoder().encode("\n\n"));
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } }
          )
      );
      const decoderHttp = createHttpApiQueryUtils(api, {
        client: decoderClient,
        keyPrefix: ["decoder"],
      });
      const failed = yield* Effect.promise(
        async () =>
          await captureFailure(
            queryClient.query(
              decoderHttp.items.watch.streamedOptions({
                sseOptions: { maxEventSize: 3 },
              })
            )
          )
      );
      expect(failed).toMatchObject({
        _tag: "EffectHttpApiQueryError",
        operation: "streamed",
        endpoint: "watch",
      });
      if (!isEffectHttpApiQueryError(failed)) {
        throw new TypeError("Expected an HTTP execution error");
      }
      expect(failed.cause.reasons[0]).toMatchObject({
        _tag: "Fail",
        error: { _tag: "SseError" },
      });
      expect(
        queryClient.getQueryData(http.items.watch.streamedKey())
      ).toStrictEqual([1, undefined]);
    })
);

describe.each(["live", "streamed"] as const)(
  "preserves mixed acquisition Causes in HTTP %s views",
  (view) => {
    it.effect("preserves the complete acquisition Cause", () =>
      Effect.gen(function* preserveMixedAcquisitionCause() {
        const defect = new Error("transport defect");
        const cause = Cause.combine(Cause.interrupt(123), Cause.die(defect));
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make(() => Effect.failCause(cause)),
        });
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["failure", view],
        });
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            queryClient.clear();
          })
        );
        const error = yield* Effect.promise(
          async () =>
            await captureFailure(
              view === "live"
                ? queryClient.query(http.items.watch.liveOptions())
                : queryClient.query(http.items.watch.streamedOptions())
            )
        );
        expect(error).toMatchObject({
          _tag: "EffectHttpApiQueryError",
          apiId: "cached-views",
          groupId: "items",
          endpoint: "watch",
          method: "GET",
          operation: view,
        });
        if (!isEffectHttpApiQueryError(error)) {
          throw new TypeError("Expected an HTTP execution error");
        }
        expect(error.cause.reasons.map((reason) => reason._tag)).toStrictEqual([
          "Interrupt",
          "Die",
        ]);
        expect(error.cause.reasons[0]).toMatchObject({ fiberId: 123 });
        const [, reason] = error.cause.reasons;
        if (reason?._tag !== "Die") {
          throw new TypeError("Expected the original defect");
        }
        expect(reason.defect).toBe(defect);
      })
    );
  }
);

describe.each(
  (["live", "streamed"] as const).flatMap((view) => [
    { view, body: 'data: "bad"\n\n', tag: "SchemaError", published: false },
    {
      view,
      body: "id: v3\ndata: 1\n\nretry: 25\n\n",
      tag: "Retry",
      published: true,
    },
  ])
)(
  "preserves HTTP $view failure $tag and prior publication",
  ({ view, body, tag, published }) => {
    it.effect("preserves the failure and previously published data", () =>
      Effect.gen(function* preserveFailureAndPriorPublication() {
        const client = yield* makeClient(() => sse(body));
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["decode", view],
        });
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            queryClient.clear();
          })
        );
        const error = yield* Effect.promise(
          async () =>
            await captureFailure(
              view === "live"
                ? queryClient.query(http.items.watch.liveOptions())
                : queryClient.query(http.items.watch.streamedOptions())
            )
        );
        if (!isEffectHttpApiQueryError(error)) {
          throw new TypeError("Expected an HTTP execution error");
        }
        expect(error.cause.reasons[0]).toMatchObject({
          _tag: "Fail",
          error: { _tag: tag },
        });
        const publishedData = view === "live" ? 1 : [1];
        expect(
          queryClient.getQueryData(
            view === "live"
              ? http.items.watch.liveKey()
              : http.items.watch.streamedKey()
          )
        ).toStrictEqual(published ? publishedData : undefined);
      })
    );
  }
);

describe.each(["live", "streamed"] as const)(
  "cancels and closes an HTTP %s body after the first publication",
  (view) => {
    it.effect("closes the body and preserves the published value", () =>
      Effect.gen(function* cancelHttpBodyAfterPublication() {
        const finalized = yield* Deferred.make<boolean>();
        let signal: AbortSignal | undefined;
        let closed = 0;
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request, _url, transportSignal) => {
            signal = transportSignal;
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.enqueue(
                        new TextEncoder().encode("data: 1\n\n")
                      );
                    },
                    cancel() {
                      closed += 1;
                      Deferred.doneUnsafe(finalized, Exit.succeed(true));
                    },
                  }),
                  { headers: { "content-type": "text/event-stream" } }
                )
              )
            );
          }),
        });
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["cancel", view],
        });
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        const queryKey =
          view === "live"
            ? http.items.watch.liveKey()
            : http.items.watch.streamedKey();
        const pending =
          view === "live"
            ? queryClient.query(http.items.watch.liveOptions())
            : queryClient.query(http.items.watch.streamedOptions());
        try {
          yield* waitForQueryState(
            queryClient,
            () => queryClient.getQueryState(queryKey)?.status === "success"
          );
          expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe(
            "fetching"
          );
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries({ queryKey, exact: true });
          });
          yield* Deferred.await(finalized);
          expect(signal?.aborted).toBe(true);
          expect(closed).toBe(1);
          expect(
            yield* Effect.promise(async () => await pending)
          ).toStrictEqual(view === "live" ? 1 : [1]);
        } finally {
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries({ queryKey, exact: true });
          });
          queryClient.clear();
        }
      })
    );
  }
);

it.effect(
  "captures immutable HTTP metadata separately from decoded data and preserves native sharing",
  () =>
    Effect.gen(function* captureImmutableMetadataWithNativeSharing() {
      let revision = 1;
      const client = yield* makeClient(() =>
        Response.json("document", {
          status: 203,
          headers: {
            "content-type": "application/json",
            etag: `"revision-${revision}"`,
          },
        })
      );
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["metadata"],
      });
      const queryClient = new QueryClient();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          queryClient.clear();
        })
      );
      const options = http.items.read.metadataOptions();
      const first = yield* Effect.promise(
        async () => await queryClient.query(options)
      );
      expect({
        view: first,
        frozen: Object.isFrozen(first),
        headersFrozen: Object.isFrozen(first.headers),
      }).toMatchObject({
        view: {
          data: { body: "document", headers: { etag: '"revision-1"' } },
          status: 203,
          headers: { etag: '"revision-1"' },
        },
        frozen: true,
        headersFrozen: true,
      });
      expect(
        yield* Effect.promise(
          async () => await queryClient.query(http.items.read.queryOptions())
        )
      ).toStrictEqual(first.data);
      expect(
        queryClient.getQueryCache().findAll({ queryKey: http.items.read.key() })
      ).toHaveLength(2);
      revision = 2;
      const second = yield* Effect.promise(
        async () => await queryClient.query(options)
      );
      expect({
        first: first.headers["etag"],
        second: second.headers["etag"],
      }).toStrictEqual({ first: '"revision-1"', second: '"revision-2"' });
      const cached = queryClient.getQueryData(options.queryKey);
      yield* Effect.promise(async () => await queryClient.query(options));
      expect(queryClient.getQueryData(options.queryKey)).toBe(cached);
    })
);

it.effect(
  "freezes custom HTTP metadata sharing without freezing manual cache writes",
  () =>
    Effect.gen(function* freezeSharedMetadataWithMutableManualWrites() {
      const client = yield* makeClient(() =>
        Response.json("document", {
          status: 203,
          headers: { etag: "revision" },
        })
      );
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["metadata-sharing"],
      });
      const queryClient = new QueryClient();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          queryClient.clear();
        })
      );
      const options = http.items.read.metadataOptions();
      yield* Effect.promise(async () => await queryClient.query(options));
      queryClient.setQueryDefaults(http.items.read.key(), {
        structuralSharing: (_previous, data) => {
          if (!Predicate.isObject(data)) {
            throw new TypeError("Expected a metadata view");
          }
          return { ...data, status: 211 };
        },
      });
      yield* Effect.promise(
        async () => await queryClient.query(http.items.read.metadataOptions())
      );
      const shared = queryClient.getQueryData(options.queryKey);
      if (shared === undefined) {
        throw new TypeError("Expected cached metadata");
      }
      expect({
        status: shared.status,
        view: Object.isFrozen(shared),
        headers: Object.isFrozen(shared.headers),
      }).toStrictEqual({ status: 211, view: true, headers: true });
      const manual = { ...shared, headers: { etag: "manual" } };
      queryClient.setQueryData(options.queryKey, manual);
      expect({
        view: Object.isFrozen(manual),
        headers: Object.isFrozen(manual.headers),
      }).toStrictEqual({ view: false, headers: false });
    })
);

describe.each(["global", "prefix"] as const)(
  "uses %s HTTP hashing across unary, infinite and open stream views",
  (mode) => {
    it.effect("uses native cache reads and writes across all views", () =>
      Effect.gen(function* shareHttpHashingAcrossCachedViews() {
        const finalized = yield* Deferred.make<boolean>();
        let closed = 0;
        let reads = 0;
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request) => {
            if (request.url.endsWith("/read")) {
              reads += 1;
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json("server", {
                    status: 203,
                    headers: { etag: "server" },
                  })
                )
              );
            }
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.enqueue(
                        new TextEncoder().encode("data: 1\n\n")
                      );
                    },
                    cancel() {
                      closed += 1;
                      if (closed === 2) {
                        Deferred.doneUnsafe(finalized, Exit.succeed(true));
                      }
                    },
                  }),
                  { headers: { "content-type": "text/event-stream" } }
                )
              )
            );
          }),
        });
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["hashing-http"],
        });
        const queryClient = new QueryClient({
          defaultOptions: {
            queries: {
              retry: false,
              staleTime: Infinity,
              queryKeyHashFn: (key) => `global:${JSON.stringify(key)}`,
            },
          },
        });
        if (mode === "prefix") {
          queryClient.setQueryDefaults(http.key(), {
            queryKeyHashFn: (key) => `prefix:${JSON.stringify(key)}`,
          });
        }
        const history = new QueryObserver(
          queryClient,
          http.items.watch.streamedOptions()
        );
        const latest = new QueryObserver(
          queryClient,
          http.items.watch.liveOptions()
        );
        const stopHistory = history.subscribe(() => {});
        const stopLatest = latest.subscribe(() => {});
        try {
          yield* waitForQueryState(
            queryClient,
            () =>
              history.getCurrentResult().status === "success" &&
              latest.getCurrentResult().status === "success"
          );
          expect({
            history: history.getCurrentResult(),
            latest: latest.getCurrentResult(),
          }).toMatchObject({
            history: { data: [1], fetchStatus: "fetching" },
            latest: { data: 1, fetchStatus: "fetching" },
          });
          queryClient.setQueryData(http.items.watch.streamedKey(), [2]);
          queryClient.setQueryData(http.items.watch.liveKey(), 2);
          expect({
            history: queryClient.getQueryData(http.items.watch.streamedKey()),
            latest: queryClient.getQueryData(http.items.watch.liveKey()),
          }).toStrictEqual({ history: [2], latest: 2 });
          const unary = http.items.read.queryOptions();
          const pages = http.items.read.infiniteOptions({
            initialPageParam: 0,
            getNextPageParam: () => {},
          });
          const returned = HttpApiSchema.withHeaders({
            body: "server",
            headers: { etag: "server" },
          });
          expect({
            unary: yield* Effect.promise(
              async () => await queryClient.query(unary)
            ),
            infinite: yield* Effect.promise(
              async () => await queryClient.infiniteQuery(pages)
            ),
          }).toStrictEqual({
            unary: returned,
            infinite: { pages: [returned], pageParams: [0] },
          });
          const manual = HttpApiSchema.withHeaders({
            body: "native",
            headers: { etag: "native" },
          });
          queryClient.setQueryData(http.items.read.queryKey(), manual);
          queryClient.setQueryData(http.items.read.infiniteKey(), {
            pages: [manual],
            pageParams: [0],
          });
          expect({
            unary: yield* Effect.promise(
              async () => await queryClient.query(unary)
            ),
            infinite: yield* Effect.promise(
              async () => await queryClient.infiniteQuery(pages)
            ),
            reads,
          }).toStrictEqual({
            unary: manual,
            infinite: { pages: [manual], pageParams: [0] },
            reads: 2,
          });
          const queries = queryClient.getQueryCache().getAll();
          expect({
            entries: queries.length,
            matchingHashes: queries.every((query) =>
              query.queryHash.startsWith(`${mode}:`)
            ),
          }).toStrictEqual({ entries: 4, matchingHashes: true });
        } finally {
          stopHistory();
          stopLatest();
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries();
          });
          yield* Deferred.await(finalized);
          queryClient.clear();
        }
      })
    );
  }
);

describe.each(["reset", "append", "replace"] as const)(
  "retains bounded HTTP %s histories with native refetch publication",
  (refetchMode) => {
    it.effect("publishes bounded histories through refetch completion", () =>
      Effect.gen(function* retainBoundedHttpRefetchHistory() {
        let calls = 0;
        const client = yield* makeClient(() => {
          calls += 1;
          return sse(
            calls === 1
              ? "data: 1\n\ndata: 2\n\ndata: 3\n\n"
              : "data: 4\n\ndata: 5\n\ndata: 6\n\n"
          );
        });
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["http-refetch"],
        });
        const options = http.items.watch.streamedOptions({
          maxChunks: 2,
          refetchMode,
        });
        const queryClient = new QueryClient();
        const publications: unknown[] = [];
        try {
          expect(
            yield* Effect.promise(async () => await queryClient.query(options))
          ).toStrictEqual([2, 3]);
          const stop = queryClient.getQueryCache().subscribe((event) => {
            if (event.type === "updated" && event.action.type === "success") {
              publications.push(event.query.state.data);
            }
          });
          try {
            const refetched = yield* Effect.promise(
              async () => await queryClient.query(options)
            );
            expect(publications.length).toBeGreaterThan(0);
            if (refetchMode === "replace") {
              expect(
                publications.every((data) => JSON.stringify(data) === "[5,6]")
              ).toBe(true);
            } else {
              expect(publications).toContainEqual(
                refetchMode === "reset" ? [4] : [3, 4]
              );
            }
            expect({
              returned: refetched,
              cached: queryClient.getQueryData(
                http.items.watch.streamedKey({ maxChunks: 2, refetchMode })
              ),
              calls,
            }).toStrictEqual({ returned: [5, 6], cached: [5, 6], calls: 2 });
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

it.effect(
  "validates HTTP history policies before skipped queries acquire a request",
  () =>
    Effect.gen(function* validateSkippedHttpHistoryPolicies() {
      const inputApi = HttpApi.make("skipped-policies").add(
        HttpApiGroup.make("events").add(
          HttpApiEndpoint.get("watch", "/watch", {
            query: { channel: Schema.String },
            success: HttpApiSchema.StreamSse({ data: Schema.Int }),
          })
        )
      );
      let requests = 0;
      const client = yield* HttpApiClient.makeWith(inputApi, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) => {
          requests += 1;
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, sse("data: 1\n\n"))
          );
        }),
      });
      const http = createHttpApiQueryUtils(inputApi, {
        client,
        keyPrefix: ["skipped-http"],
      });
      for (const input of [
        { query: { channel: "news" } },
        skipToken,
      ] as const) {
        for (const maxChunks of [0, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
          const build = () =>
            http.events.watch.streamedOptions({ input, maxChunks });
          expect(build).toThrow(
            expect.objectContaining({
              code: "InvalidMaxChunks",
              apiId: "skipped-policies",
              endpoint: "watch",
            })
          );
        }
      }
      const queryClient = new QueryClient();
      const observer = new QueryObserver(
        queryClient,
        http.events.watch.streamedOptions({
          input: skipToken,
          initialData: [9],
          maxChunks: 2,
          refetchMode: "append",
        })
      );
      const stop = observer.subscribe(() => {});
      try {
        expect(observer.getCurrentResult()).toMatchObject({
          data: [9],
          fetchStatus: "idle",
        });
        expect(requests).toBe(0);
      } finally {
        stop();
        queryClient.clear();
      }
    })
);
