import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { HttpApi, HttpApiGroup } from "effect/http-api";

export const makeUnusedHttpClient = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<ApiId, Groups>
) =>
  HttpApiClient.makeWith(api, {
    baseUrl: "https://example.test",
    httpClient: HttpClient.make(() =>
      Effect.die(
        new Error("Key preparation tests must not execute HTTP requests")
      )
    ),
  });
