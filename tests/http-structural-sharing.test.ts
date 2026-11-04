import { expect, it } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";

import { configureUtils, createHttpApiQueryUtils } from "#effect-api-query";

import {
  shareMetadataSnapshot,
  Snapshot,
} from "./types/docs-structural-sharing";

const api = HttpApi.make("rich-sharing").add(
  HttpApiGroup.make("readings").add(
    HttpApiEndpoint.get("read", "/readings", {
      success: Schema.toCodecJson(Snapshot),
    })
  )
);

it.effect(
  "shares decoded HTTP metadata while preserving fetched freezing",
  () =>
    Effect.gen(function* shareRichMetadata() {
      let revision = 1;
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.sync(() =>
            HttpClientResponse.fromWeb(
              request,
              Response.json(
                {
                  revision,
                  readings: [
                    {
                      id: 1,
                      observedAt: "2026-01-01T00:00:00.000Z",
                      values: [["temperature", 20]],
                      labels: ["indoor"],
                      note: "calibrated",
                      attachment: null,
                    },
                  ],
                },
                { headers: { etag: `revision-${revision}` } }
              )
            )
          )
        ),
      });
      const base = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["metadata-sharing"],
      });
      const http = configureUtils(base, {
        metadata: { policy: { structuralSharing: shareMetadataSnapshot } },
      });
      const queryClient = new QueryClient();
      const observer = new QueryObserver(
        queryClient,
        http.readings.read.metadataOptions({ enabled: false })
      );
      const stop = observer.subscribe(() => {});
      try {
        const first = yield* Effect.promise(
          async () =>
            await queryClient.query(http.readings.read.metadataOptions())
        );
        yield* Effect.promise(
          async () =>
            await queryClient.query(http.readings.read.metadataOptions())
        );
        const equal = queryClient.getQueryData(
          http.readings.read.metadataKey()
        );
        expect(equal).toBe(first);
        revision = 2;
        yield* Effect.promise(
          async () =>
            await queryClient.query(http.readings.read.metadataOptions())
        );
        const changed = queryClient.getQueryData(
          http.readings.read.metadataKey()
        );
        expect(changed?.data.readings).toBe(first.data.readings);
        expect(changed?.headers["etag"]).toBe("revision-2");
        expect({
          envelopeFrozen: Object.isFrozen(changed),
          headersFrozen: Object.isFrozen(changed?.headers),
          dataFrozen: Object.isFrozen(changed?.data),
        }).toStrictEqual({
          envelopeFrozen: true,
          headersFrozen: true,
          dataFrozen: false,
        });
        expect(observer.getCurrentResult().data).toBe(changed);
      } finally {
        stop();
        queryClient.clear();
      }
    })
);
