import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";

const recordsApi = HttpApi.make("records-api").add(
  HttpApiGroup.make("records").add(
    HttpApiEndpoint.get("watch", "/records", {
      success: HttpApiSchema.StreamNdjson({
        schema: Schema.Struct({ id: Schema.FiniteFromString }),
        maxElementBytes: "1 MiB",
      }),
    })
  )
);

function recordOptions(client: HttpApiClient.ForApi<typeof recordsApi>) {
  const http = createHttpApiQueryUtils(recordsApi, {
    client,
    keyPrefix: ["records-app"],
  });
  return {
    history: http.records.watch.streamedOptions({ maxChunks: 100 }),
    latest: http.records.watch.liveOptions(),
  };
}

void recordOptions;
