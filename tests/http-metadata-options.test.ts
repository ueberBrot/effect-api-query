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

import {
  createHttpApiQueryUtils,
  withQueryInterceptor,
} from "#effect-api-query";

import { waitForQueryState } from "./fixtures/query-cache.ts";

const api = HttpApi.make("metadata-options").add(
  HttpApiGroup.make("documents").add(
    HttpApiEndpoint.get("read", "/document", {
      success: Schema.Struct({ title: Schema.String }),
    })
  )
);

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

it.effect(
  "preserves fetched metadata policy when an interceptor replaces the envelope",
  () =>
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
      const read = withQueryInterceptor(
        http.documents.read,
        "metadata",
        async ({ next }) => ({
          ...(await next()),
        })
      );
      try {
        yield* Effect.promise(async () => await queryClient.query(read()));
        const fetched = queryClient.getQueryData(
          http.documents.read.metadataKey()
        );
        expect(fetched?.status).toBe(211);
        expect(sharingCalls).toBe(1);
        expect(Object.isFrozen(fetched)).toBe(true);
        expect(Object.isFrozen(fetched?.headers)).toBe(true);
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
