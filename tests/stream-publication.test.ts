import { describe, expect, it } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { Deferred, Effect, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
} from "#effect-api-query";

import { captureFailure } from "./fixtures/async";
import { makeRpcTestClient } from "./fixtures/effect-rpc";
import { waitForQueryState } from "./fixtures/query-cache";

describe.each(["rpc", "http"] as const)("publication adapter %s", (adapter) => {
  it.effect(
    "batches $adapter publications while preserving ordered elements and immutable histories",
    () =>
      Effect.gen(function* batchesOrderedPublications() {
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Int, stream: true })
        );
        const client = yield* makeRpcTestClient(group, {
          watch: () => Stream.make(1, 2, 3, 4, 5, 6),
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["publication"],
        });
        const api = HttpApi.make("publication").add(
          HttpApiGroup.make("events").add(
            HttpApiEndpoint.get("watch", "/watch", {
              success: HttpApiSchema.StreamSse({ data: Schema.Int }),
            })
          )
        );
        const httpClient = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  "data: 1\n\ndata: 2\n\ndata: 3\n\ndata: 4\n\ndata: 5\n\ndata: 6\n\n",
                  {
                    headers: { "content-type": "text/event-stream" },
                  }
                )
              )
            )
          ),
        });
        const http = createHttpApiQueryUtils(api, {
          client: httpClient,
          keyPrefix: ["publication"],
        });
        const leaf = adapter === "rpc" ? rpc.watch : http.events.watch;
        const options =
          adapter === "rpc"
            ? rpc.watch.streamedOptions({
                maxChunks: "unbounded",
                publicationBatchSize: 3,
                publicationMaxWaitMs: 50,
              })
            : http.events.watch.streamedOptions({
                maxChunks: "unbounded",
                publicationBatchSize: 3,
                publicationMaxWaitMs: 50,
              });
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
          const result = yield* Effect.promise(async () =>
            adapter === "rpc"
              ? await queryClient.query(
                  rpc.watch.streamedOptions({
                    maxChunks: "unbounded",
                    publicationBatchSize: 3,
                    publicationMaxWaitMs: 50,
                  })
                )
              : await queryClient.query(
                  http.events.watch.streamedOptions({
                    maxChunks: "unbounded",
                    publicationBatchSize: 3,
                    publicationMaxWaitMs: 50,
                  })
                )
          );
          expect({ result, publications }).toStrictEqual({
            result: [1, 2, 3, 4, 5, 6],
            publications: [[1], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6]],
          });
          expect(options.queryKey).toStrictEqual(
            leaf.streamedKey({
              maxChunks: "unbounded",
              publicationBatchSize: 3,
              publicationMaxWaitMs: 50,
            })
          );
          expect(
            leaf.streamedKey({
              maxChunks: "unbounded",
              publicationBatchSize: 1,
            })
          ).toStrictEqual(leaf.streamedKey({ maxChunks: "unbounded" }));
          expect(options.queryKey).not.toStrictEqual(
            leaf.streamedKey({ maxChunks: "unbounded" })
          );
          expect(options).not.toHaveProperty("publicationBatchSize");
        } finally {
          stop();
          queryClient.clear();
        }
      })
  );
});

describe.each(["reset", "append", "replace"] as const)(
  "publication refetch mode %s",
  (refetchMode) => {
    it.effect(
      "retains native %s refetch behavior and bounds across publication batches",
      () =>
        Effect.gen(function* preservesBatchedRefetchModes() {
          const group = RpcGroup.make(
            Rpc.make("watch", { success: Schema.Int, stream: true })
          );
          const client = yield* makeRpcTestClient(group, {
            watch: () => Stream.make(1, 2, 3, 4, 5),
          });
          const rpc = createRpcQueryUtils(group, {
            client,
            keyPrefix: ["publication-refetch"],
          });
          const options = rpc.watch.streamedOptions({
            refetchMode,
            maxChunks: 3,
            publicationBatchSize: 2,
          });
          const queryClient = new QueryClient();
          queryClient.setQueryData(options.queryKey, [9]);
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
            expect(
              yield* Effect.promise(
                async () => await queryClient.query(options)
              )
            ).toStrictEqual([3, 4, 5]);
            expect(publications).toStrictEqual(
              refetchMode === "replace"
                ? [[3, 4, 5]]
                : [
                    refetchMode === "append" ? [9, 1] : [1],
                    [1, 2, 3],
                    [3, 4, 5],
                  ]
            );
          } finally {
            stop();
            queryClient.clear();
          }
        })
    );
  }
);

it.effect("flushes a partial batch before propagating a stream failure", () =>
  Effect.gen(function* flushesBeforeStreamFailure() {
    const group = RpcGroup.make(
      Rpc.make("watch", { success: Schema.Int, stream: true })
    );
    const failure = new Error("disconnected");
    const client = yield* makeRpcTestClient(group, {
      watch: () =>
        Stream.make(1, 2, 3).pipe(Stream.concat(Stream.die(failure))),
    });
    const rpc = createRpcQueryUtils(group, {
      client,
      keyPrefix: ["publication-failure"],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const options = rpc.watch.streamedOptions({
      maxChunks: "unbounded",
      publicationBatchSize: 10,
    });
    try {
      const error = yield* Effect.promise(
        async () => await captureFailure(queryClient.query(options))
      );
      expect(error).toMatchObject({ _tag: "EffectRpcQueryError" });
      expect(queryClient.getQueryData(options.queryKey)).toStrictEqual([
        1, 2, 3,
      ]);
    } finally {
      queryClient.clear();
    }
  })
);

it.effect(
  "publishes the first value of an open batched stream and drops pending values on cancellation",
  () =>
    Effect.gen(function* cancelsBufferedPublications() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const buffered = yield* Deferred.make<boolean>();
      const finalized = yield* Deferred.make<boolean>();
      const client = yield* makeRpcTestClient(group, {
        watch: () =>
          Stream.make(1, 2).pipe(
            Stream.concat(
              Stream.fromEffect(
                Deferred.succeed(buffered, true).pipe(
                  Effect.andThen(Effect.never)
                )
              )
            ),
            Stream.ensuring(Deferred.succeed(finalized, true))
          ),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["publication-cancel"],
      });
      const queryClient = new QueryClient();
      const options = rpc.watch.streamedOptions({
        maxChunks: "unbounded",
        publicationBatchSize: 10,
      });
      const observer = new QueryObserver(queryClient, options);
      const stop = observer.subscribe(() => {});
      try {
        yield* Deferred.await(buffered);
        yield* waitForQueryState(
          queryClient,
          () => observer.getCurrentResult().status === "success"
        );
        expect(observer.getCurrentResult()).toMatchObject({
          data: [1],
          fetchStatus: "fetching",
        });
        yield* Effect.promise(async () => {
          await queryClient.cancelQueries(
            { queryKey: options.queryKey },
            { revert: false }
          );
        });
        yield* Deferred.await(finalized);
        expect(queryClient.getQueryData(options.queryKey)).toStrictEqual([1]);
      } finally {
        stop();
        queryClient.clear();
      }
    })
);

it.effect("rejects invalid publication batch sizes during preparation", () =>
  Effect.gen(function* rejectsInvalidBatchSizes() {
    const group = RpcGroup.make(
      Rpc.make("watch", { success: Schema.Int, stream: true })
    );
    const client = yield* makeRpcTestClient(group, {
      watch: () => Stream.empty,
    });
    const rpc = createRpcQueryUtils(group, {
      client,
      keyPrefix: ["publication-validation"],
    });
    for (const publicationBatchSize of [0, -1, 1.5, Infinity, Number.NaN]) {
      expect(() =>
        rpc.watch.streamedOptions({
          maxChunks: "unbounded",
          publicationBatchSize,
        })
      ).toThrow(RangeError);
    }
  })
);

it.effect(
  "publishes a quiet RPC batch at its deadline and closes the open stream",
  () =>
    Effect.gen(function* publishesQuietBatch() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const finalized = yield* Deferred.make<boolean>();
      const client = yield* makeRpcTestClient(group, {
        watch: () =>
          Stream.make(1, 2).pipe(
            Stream.concat(Stream.never),
            Stream.ensuring(Deferred.succeed(finalized, true))
          ),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["deadline"],
      });
      const options = rpc.watch.streamedOptions({
        maxChunks: "unbounded",
        publicationBatchSize: 10,
        publicationMaxWaitMs: 5,
      });
      expect(options.queryKey).toStrictEqual(
        rpc.watch.streamedKey({
          maxChunks: "unbounded",
          publicationBatchSize: 10,
          publicationMaxWaitMs: 5,
        })
      );
      expect(options.queryKey).not.toStrictEqual(
        rpc.watch.streamedKey({
          maxChunks: "unbounded",
          publicationBatchSize: 10,
        })
      );
      expect(options).not.toHaveProperty("publicationMaxWaitMs");
      const queryClient = new QueryClient();
      const observer = new QueryObserver(queryClient, options);
      const stop = observer.subscribe(() => {});
      try {
        yield* waitForQueryState(
          queryClient,
          () => observer.getCurrentResult().data?.length === 2
        );
        expect(observer.getCurrentResult().data).toStrictEqual([1, 2]);
        yield* Effect.promise(async () => {
          await queryClient.cancelQueries(
            { queryKey: options.queryKey },
            { revert: false }
          );
        });
        yield* Deferred.await(finalized);
        for (const publicationMaxWaitMs of [
          0,
          -1,
          1.5,
          Infinity,
          Number.NaN,
          2_147_483_648,
        ]) {
          expect(() =>
            rpc.watch.streamedOptions({
              maxChunks: "unbounded",
              publicationMaxWaitMs,
            })
          ).toThrow(RangeError);
        }
      } finally {
        stop();
        queryClient.clear();
      }
    })
);
