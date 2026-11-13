import type { QueryClient } from "@tanstack/query-core";
import {
  schemaStructuralSharing,
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import type {
  EffectHttpApiQueryError,
  EffectRpcQueryError,
  InferQueryData,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

import {
  Reading,
  shareMetadataSnapshot,
  shareSnapshot,
  Snapshot,
} from "./docs-structural-sharing";

const group = RpcGroup.make(
  Rpc.make("read", { success: Snapshot, error: Schema.Literal("missing") })
);
const api = HttpApi.make("readings").add(
  HttpApiGroup.make("readings").add(
    HttpApiEndpoint.get("read", "/readings", {
      success: Schema.toCodecJson(Snapshot),
    })
  )
);

function readingQueries<E>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>, E>,
  httpClient: HttpApiClient.ForApi<typeof api>,
  queryClient: QueryClient
) {
  const rpc = createRpcQueryUtils<typeof group, readonly ["readings"], E>(
    group,
    {
      client,
      keyPrefix: ["readings"],
    }
  );
  const read = configureUtils(rpc.read, {
    query: { policy: { structuralSharing: shareSnapshot } },
  });
  const options = read.queryOptions({ select: (data) => data.readings.length });
  queryClient.query(options) satisfies Promise<number>;
  queryClient.getQueryData(options.queryKey) satisfies
    | InferQueryData<typeof rpc.read>
    | undefined;
  options.select satisfies ((data: typeof Snapshot.Type) => number) | undefined;
  read.queryOptions({
    retry: (_count, error) => {
      error satisfies EffectRpcQueryError<"missing" | E>;
      return false;
    },
  });
  queryClient.setQueryData(options.queryKey, {
    // @ts-expect-error A rich-value policy preserves the declared cached data.
    revision: "wrong",
    readings: [],
  });
  const cached = queryClient.getQueryData(options.queryKey);
  cached?.readings satisfies readonly Reading[] | undefined;

  const http = createHttpApiQueryUtils(api, {
    client: httpClient,
    keyPrefix: ["readings"],
  });
  const metadata = configureUtils(http.readings.read, {
    metadata: { policy: { structuralSharing: shareMetadataSnapshot } },
  });
  const metadataOptions = metadata.metadataOptions({
    select: ({ data }) => data.readings.length,
    retry: (_count, error) => {
      error satisfies EffectHttpApiQueryError<unknown>;
      return false;
    },
  });
  queryClient.query(metadataOptions) satisfies Promise<number>;
  queryClient.getQueryData(metadataOptions.queryKey)?.data satisfies
    | typeof Snapshot.Type
    | undefined;
  return { read, metadata };
}

void readingQueries;

// @ts-expect-error Equivalence is mandatory; encoded equality is never inferred.
schemaStructuralSharing(Reading, {});
schemaStructuralSharing(Reading, {
  // @ts-expect-error The equivalence must accept decoded Reading values.
  equivalence: (a: string, b: string) => a === b,
});
// @ts-expect-error Sharing must be synchronous.
schemaStructuralSharing(Reading, { equivalence: async () => true });
// @ts-expect-error A schema is required.
schemaStructuralSharing({}, { equivalence: () => true });
