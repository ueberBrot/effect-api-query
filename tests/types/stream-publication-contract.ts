import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  defineHttpApiPolicy,
  defineRpcPolicy,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const group = RpcGroup.make(
  Rpc.make("watch", { success: Schema.Int, stream: true })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, {
  client,
  keyPrefix: ["publication-types"],
});
rpc.watch.streamedOptions({
  maxChunks: "unbounded",
  publicationBatchSize: 8,
  select: (values) => values.length,
});
rpc.watch.streamedKey({ maxChunks: "unbounded", publicationBatchSize: 8 });
const invalidPublicationBatch = {
  maxChunks: "unbounded" as const,
  publicationBatchSize: "8",
};
// @ts-expect-error Publication batches count accumulated elements.
rpc.watch.streamedOptions(invalidPublicationBatch);
// @ts-expect-error Live views publish the latest individual value.
rpc.watch.liveOptions({ publicationBatchSize: 8 });

const api = HttpApi.make("publication-types").add(
  HttpApiGroup.make("events").add(
    HttpApiEndpoint.get("watch", "/watch", {
      success: HttpApiSchema.StreamSse({ data: Schema.Int }),
    })
  )
);
declare const httpClient: HttpApiClient.ForApi<typeof api>;
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["publication-types"],
});
http.events.watch.streamedOptions({
  maxChunks: "unbounded",
  publicationBatchSize: 8,
});
http.events.watch.streamedKey({
  maxChunks: "unbounded",
  publicationBatchSize: 8,
});
// @ts-expect-error Live views do not accept accumulated publication policy.
http.events.watch.liveOptions({ publicationBatchSize: 8 });

const configuredSse = configureUtils(http.events.watch, {
  streamed: {
    maxChunks: 4,
    sseOptions: { maxEventSize: 128, dispatchEmptyNamedEvents: true },
  },
  live: {
    coalesceMs: 1000,
    sseOptions: { maxEventSize: 128, dispatchEmptyNamedEvents: true },
  },
});
const sseScopedPolicy = defineHttpApiPolicy(
  api,
  {
    paths: {
      "events.watch": {
        streamed: {
          maxChunks: 4,
          sseOptions: { maxEventSize: 128, dispatchEmptyNamedEvents: true },
        },
        live: {
          coalesceMs: 1000,
          sseOptions: { maxEventSize: 128, dispatchEmptyNamedEvents: true },
        },
      },
    },
  },
  { keyPrefix: ["publication-types"] }
);
configuredSse.streamedOptions();
configuredSse.streamedKey();
configuredSse.liveOptions();
configuredSse.liveKey();
configuredSse.liveOptions({
  sseOptions: { maxEventSize: 128, dispatchEmptyNamedEvents: true },
});
configuredSse.liveKey({
  coalesceMs: undefined,
  sseOptions: { maxEventSize: 64, dispatchEmptyNamedEvents: false },
});
const configuredScopedSse = configureUtils(http, sseScopedPolicy);
configuredScopedSse.events.watch.streamedOptions();
configuredScopedSse.events.watch.streamedKey();
configuredScopedSse.events.watch.liveOptions();
configuredScopedSse.events.watch.liveKey();
configureUtils(rpc.watch, {
  live: {
    // @ts-expect-error RPC streams have no SSE decoder policy.
    sseOptions: { maxEventSize: 128 },
  },
});
configureUtils(rpc.watch, {
  streamed: {
    maxChunks: 4,
    // @ts-expect-error RPC streamed policies have no SSE decoder policy.
    sseOptions: { maxEventSize: 128 },
  },
});
defineRpcPolicy.withClientError<never>()(
  group,
  {
    paths: {
      watch: {
        live: {
          // @ts-expect-error RPC policy assembly rejects SSE decoder policy inside scoped maps.
          sseOptions: { maxEventSize: 128 },
        },
      },
    },
  },
  { keyPrefix: ["publication-types"] }
);
