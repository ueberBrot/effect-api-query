import { it } from "@effect/vitest";
import {
  dehydrate,
  hydrate,
  QueryClient,
  QueryObserver,
} from "@tanstack/query-core";
import type { QueryOptions } from "@tanstack/query-core";
import { Deferred, Effect, Predicate, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { describe, expect } from "vite-plus/test";

import { configureUtils, createHttpApiQueryUtils } from "#effect-api-query";

import { waitForQueryState } from "./fixtures/query-cache.ts";

const api = HttpApi.make("metadata-options").add(
  HttpApiGroup.make("documents").add(
    HttpApiEndpoint.get("read", "/document", {
      success: Schema.Struct({ title: Schema.String }),
    })
  )
);
describe.each([
  "non-enumerable",
  "accessor",
  "hidden header",
  "live status",
  "unused getter",
] as const)("metadata refetch after a %s seed", (seed) => {
  it.effect("preserves own raw response headers", () =>
    Effect.gen(function* preserveRawMetadataHeaders() {
      let etag = "first";
      let title = "document";
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.sync(() =>
            HttpClientResponse.fromWeb(
              request,
              Response.json(
                { title },
                {
                  headers: [
                    ["__proto__", "raw header"],
                    ["etag", etag],
                  ],
                }
              )
            )
          )
        ),
      });
      const {
        documents: { read },
      } = createHttpApiQueryUtils(api, { client });
      const queryClient = new QueryClient();
      const fetch = async () => await queryClient.query(read.metadataOptions());
      try {
        let seedEtag = etag;
        let seedStatus = 200;
        const matchingHeaders = {
          ["__proto__"]: "raw header",
          "content-type": "application/json",
          etag,
        };
        let initialHeaders = matchingHeaders;
        if (seed === "accessor") {
          initialHeaders = {
            ...matchingHeaders,
            get etag() {
              return seedEtag;
            },
          };
        } else if (seed === "non-enumerable") {
          initialHeaders = Object.defineProperty(
            { ...matchingHeaders, extra: "seed" },
            "__proto__",
            { enumerable: false }
          );
        } else if (seed === "hidden header") {
          initialHeaders = Object.defineProperty(
            { ...matchingHeaders },
            "extra",
            { value: "seed" }
          );
        }
        const initial = {
          data: { title },
          status: 200,
          headers: Object.freeze(initialHeaders),
        };
        if (seed === "live status") {
          Object.defineProperty(initial, "status", {
            get: () => seedStatus,
            enumerable: true,
          });
        } else if (seed === "unused getter") {
          Object.defineProperty(initial, "extra", {
            get: () => {
              throw new Error("Unused seed getter");
            },
            enumerable: true,
          });
        }
        queryClient.setQueryData(read.metadataKey(), Object.freeze(initial));
        const first = yield* Effect.promise(fetch);
        seedEtag = "changed";
        seedStatus = 203;
        const seeded = queryClient.getQueryData(read.metadataKey());
        expect({
          ownHeader: Object.hasOwn(first.headers, "__proto__"),
          headers: seeded?.headers,
          extra: seeded?.headers["extra"],
          status: seeded?.status,
          dataShared: seeded?.data === initial.data,
        }).toStrictEqual({
          ownHeader: true,
          headers: first.headers,
          extra: undefined,
          status: 200,
          dataShared: true,
        });

        etag = "second";
        yield* Effect.promise(fetch);
        const refreshed = queryClient.getQueryData(read.metadataKey());
        expect(refreshed?.headers).toStrictEqual({
          ["__proto__"]: "raw header",
          "content-type": "application/json",
          etag: "second",
        });
        expect({
          headersFrozen: Object.isFrozen(refreshed?.headers),
          envelopeFrozen: Object.isFrozen(refreshed),
          dataShared: refreshed?.data === seeded?.data,
        }).toStrictEqual({
          headersFrozen: true,
          envelopeFrozen: true,
          dataShared: true,
        });

        yield* Effect.promise(fetch);
        expect(queryClient.getQueryData(read.metadataKey())).toBe(refreshed);

        title = "updated document";
        yield* Effect.promise(fetch);
        expect(queryClient.getQueryData(read.metadataKey())?.headers).toBe(
          refreshed?.headers
        );
      } finally {
        queryClient.clear();
      }
    })
  );
});
it.effect(
  "keeps initial, hydrated, manual and selected metadata data application-owned",
  () =>
    Effect.gen(function* preserveApplicationOwnedMetadata() {
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(
                { title: "fetched" },
                { headers: { etag: "server" } }
              )
            )
          )
        ),
      });
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["ownership"],
      });
      let inheritedCalls = 0;
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            structuralSharing: (_previous, data) => {
              inheritedCalls += 1;
              if (!Predicate.isObject(data)) {
                throw new TypeError("Expected metadata");
              }
              return { ...data, status: 211 };
            },
          },
        },
      });
      const hydratedClient = new QueryClient();
      const initialData = {
        data: { title: "initial" },
        status: 203,
        headers: { etag: "initial" },
      };
      const observer = new QueryObserver(
        queryClient,
        http.documents.read.metadataOptions({
          initialData,
          staleTime: Infinity,
          select: ({ data }) => ({ title: data.title }),
        })
      );
      const stop = observer.subscribe(() => {});
      try {
        expect({
          initialFrozen: Object.isFrozen(initialData),
          selectedFrozen: Object.isFrozen(observer.getCurrentResult().data),
          inheritedCalls,
        }).toStrictEqual({
          initialFrozen: false,
          selectedFrozen: false,
          inheritedCalls: 0,
        });
        yield* Effect.promise(async () => await observer.refetch());
        expect({
          status: queryClient.getQueryData(http.documents.read.metadataKey())
            ?.status,
          selectedFrozen: Object.isFrozen(observer.getCurrentResult().data),
          inheritedCalls,
        }).toStrictEqual({
          status: 211,
          selectedFrozen: false,
          inheritedCalls: 1,
        });
        const manual = {
          data: { title: "manual" },
          status: 207,
          headers: { etag: "manual" },
        };
        queryClient.setQueryData(http.documents.read.metadataKey(), manual);
        const cached = queryClient.getQueryData(
          http.documents.read.metadataKey()
        );
        expect({
          status: cached?.status,
          cachedFrozen: Object.isFrozen(cached),
          headersFrozen: Object.isFrozen(cached?.headers),
          dataFrozen: Object.isFrozen(manual.data),
        }).toStrictEqual({
          status: 207,
          cachedFrozen: false,
          headersFrozen: false,
          dataFrozen: false,
        });
        hydrate(hydratedClient, dehydrate(queryClient));
        expect({
          hydratedFrozen: Object.isFrozen(
            hydratedClient.getQueryData(http.documents.read.metadataKey())
          ),
          inheritedCalls,
        }).toStrictEqual({ hydratedFrozen: false, inheritedCalls: 1 });
      } finally {
        stop();
        queryClient.clear();
        hydratedClient.clear();
      }
    })
);
const metadataReplacements = (["global", "prefix", "local"] as const).flatMap(
  (defaults) =>
    (["builder", "tree"] as const).map((replacement) => ({
      defaults,
      replacement,
    }))
);
describe.each(metadataReplacements)(
  "pending metadata $replacement replacement with $defaults sharing",
  ({ defaults, replacement }) => {
    it.effect("retains sharing and freezing after option replacement", () =>
      Effect.gen(function* retainPendingMetadataPolicy() {
        const started = yield* Deferred.make<boolean>();
        const release = yield* Deferred.make<boolean>();
        let requests = 0;
        let sharingCalls = 0;
        const sharing: Exclude<
          QueryOptions["structuralSharing"],
          boolean | undefined
        > = (_previous, data) => {
          sharingCalls += 1;
          if (!Predicate.isObject(data)) {
            throw new TypeError("Expected metadata");
          }
          return { ...data, status: 211, headers: { etag: "selected" } };
        };
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request) =>
            Effect.gen(function* respondAfterMetadataReplacement() {
              requests += 1;
              if (requests === 2) {
                yield* Deferred.succeed(started, true);
                yield* Deferred.await(release);
              }
              return HttpClientResponse.fromWeb(
                request,
                Response.json(
                  { title: "document" },
                  { headers: { etag: "server" } }
                )
              );
            })
          ),
        });
        const makeTree = () =>
          createHttpApiQueryUtils(api, {
            client,
            keyPrefix: ["metadata-options"],
          });
        const http = makeTree();
        const queryClient = new QueryClient({
          defaultOptions: {
            queries: {
              retry: false,
              structuralSharing: defaults === "prefix" ? true : sharing,
            },
          },
        });
        if (defaults === "prefix") {
          queryClient.setQueryDefaults(http.documents.read.key(), {
            structuralSharing: sharing,
          });
        }
        const options = () =>
          http.documents.read.metadataOptions(
            defaults === "local" ? { structuralSharing: false } : undefined
          );
        yield* Effect.promise(async () => await queryClient.query(options()));
        expect(
          queryClient.getQueryData(http.documents.read.metadataKey())?.status
        ).toBe(defaults === "local" ? 200 : 211);
        const observer = new QueryObserver(queryClient, options());
        const stop = observer.subscribe(() => {});
        try {
          yield* Deferred.await(started);
          const next = replacement === "tree" ? makeTree() : http;
          observer.setOptions(
            next.documents.read.metadataOptions(
              defaults === "local" ? { structuralSharing: false } : undefined
            )
          );
          yield* Deferred.succeed(release, true);
          yield* waitForQueryState(
            queryClient,
            () => observer.getCurrentResult().fetchStatus === "idle"
          );
          const cached = queryClient.getQueryData(
            http.documents.read.metadataKey()
          );
          expect(cached).toMatchObject({
            data: { title: "document" },
            status: defaults === "local" ? 200 : 211,
            headers: { etag: defaults === "local" ? "server" : "selected" },
          });
          expect({
            cachedFrozen: Object.isFrozen(cached),
            headersFrozen: Object.isFrozen(cached?.headers),
            sharingCalls,
            requests,
          }).toStrictEqual({
            cachedFrozen: true,
            headersFrozen: true,
            sharingCalls: defaults === "local" ? 0 : 2,
            requests: 2,
          });
        } finally {
          stop();
          queryClient.clear();
        }
      })
    );
  }
);
describe.each([
  { mode: "replace", source: "getter" },
  { mode: "replace", source: "hidden getter" },
  { mode: "fallback", source: "mutable" },
  { mode: "fallback", source: "class" },
] as const)(
  "metadata interceptor $mode envelope with $source input",
  ({ mode, source }) => {
    it.effect("freezes imperative and cached results with their policy", () =>
      Effect.gen(function* retainInterceptedMetadataPolicy() {
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({ title: "fetched" })
              )
            )
          ),
        });
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["intercepted-metadata"],
        });
        let sharingCalls = 0;
        const queryClient = new QueryClient({
          defaultOptions: {
            queries: {
              structuralSharing: (_previous, data) => {
                sharingCalls += 1;
                if (!Predicate.isObject(data)) {
                  throw new TypeError("Expected metadata");
                }
                return { ...data, status: 211 };
              },
            },
          },
        });
        const sourceHeaders = { etag: "intercepted" };
        let headers = sourceHeaders;
        if (source === "getter") {
          headers = Object.freeze({
            get etag() {
              return sourceHeaders.etag;
            },
          });
        } else if (source === "hidden getter") {
          headers = Object.freeze(
            Object.defineProperty({ ...sourceHeaders }, "extra", {
              get: () => sourceHeaders.etag,
            })
          );
        }
        const data = { title: mode };
        const envelope = { data, status: 200, headers };
        class MetadataFallback {
          readonly #envelope = envelope;
          get data() {
            return this.#envelope.data;
          }
          get status() {
            return this.#envelope.status;
          }
          get headers() {
            return this.#envelope.headers;
          }
        }
        const replacement =
          source === "class" ? new MetadataFallback() : envelope;
        const read = configureUtils(http.documents.read, {
          metadata: {
            interceptors: [
              async ({ next }) =>
                mode === "replace"
                  ? { ...(await next()), ...envelope }
                  : replacement,
            ],
          },
        }).metadataOptions;
        try {
          const result = yield* Effect.promise(
            async () => await queryClient.query(read())
          );
          expect({
            status: result.status,
            sameData: result.data === data,
            envelopeFrozen: Object.isFrozen(result),
            headersFrozen: Object.isFrozen(result.headers),
            sourceFrozen: Object.isFrozen(replacement),
            sourceHeadersFrozen: Object.isFrozen(sourceHeaders),
            dataFrozen: Object.isFrozen(data),
          }).toStrictEqual({
            status: 200,
            sameData: true,
            envelopeFrozen: true,
            headersFrozen: true,
            sourceFrozen: false,
            sourceHeadersFrozen: false,
            dataFrozen: false,
          });
          sourceHeaders.etag = "changed";
          expect(result.headers).toStrictEqual({ etag: "intercepted" });
          const fetched = queryClient.getQueryData(
            http.documents.read.metadataKey()
          );
          expect({
            status: fetched?.status,
            sameData: fetched?.data === data,
            etag: fetched?.headers["etag"],
            extra: fetched?.headers["extra"],
            imperativeExtra: result.headers["extra"],
            sharingCalls,
            envelopeFrozen: Object.isFrozen(fetched),
            headersFrozen: Object.isFrozen(fetched?.headers),
          }).toStrictEqual({
            status: 211,
            sameData: true,
            etag: "intercepted",
            extra: undefined,
            imperativeExtra: undefined,
            sharingCalls: 1,
            envelopeFrozen: true,
            headersFrozen: true,
          });
          queryClient.setQueryData(http.documents.read.metadataKey(), {
            data: { title: "manual" },
            status: 207,
            headers: {},
          });
          expect({
            sharingCalls,
            cachedFrozen: Object.isFrozen(
              queryClient.getQueryData(http.documents.read.metadataKey())
            ),
          }).toStrictEqual({ sharingCalls: 1, cachedFrozen: false });
        } finally {
          queryClient.clear();
        }
      })
    );
  }
);
