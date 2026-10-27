import { QueryClient } from "@tanstack/query-core";
import {
  createHttpApiQueryUtils,
  type InferMutationData,
  type InferQueryData,
} from "@ueberbrot/effect-api-query";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const api = HttpApi.make("empty-success").add(
  HttpApiGroup.make("responses").add(
    HttpApiEndpoint.get("empty", "/empty", { success: [] }),
    HttpApiEndpoint.get("explicit", "/explicit", {
      success: HttpApiSchema.NoContent,
    })
  )
);
declare const client: HttpApiClient.ForApi<typeof api>;
const http = createHttpApiQueryUtils(api, {
  client,
  keyPrefix: ["empty-success"],
});
const queryClient = new QueryClient();
const empty = http.responses.empty;
const explicit = http.responses.explicit;

type BufferedBuilder =
  | "key"
  | "queryKey"
  | "queryOptions"
  | "metadataKey"
  | "metadataOptions"
  | "infiniteKey"
  | "infiniteOptions"
  | "mutationKey"
  | "mutationOptions";

true satisfies Assert<Equal<keyof typeof empty, BufferedBuilder>>;
true satisfies Assert<Equal<keyof typeof explicit, BufferedBuilder>>;
true satisfies Assert<Equal<InferQueryData<typeof empty>, null>>;
true satisfies Assert<Equal<InferQueryData<typeof explicit>, null>>;
true satisfies Assert<Equal<InferMutationData<typeof empty>, void>>;
true satisfies Assert<Equal<InferMutationData<typeof explicit>, void>>;
true satisfies Assert<
  Equal<InferQueryData<typeof empty, "metadata">["data"], null>
>;
true satisfies Assert<
  Equal<InferQueryData<typeof explicit, "metadata">["data"], null>
>;
true satisfies Assert<
  typeof empty extends Record<string, unknown> ? true : false
>;
true satisfies Assert<
  typeof explicit extends Record<string, unknown> ? true : false
>;

const emptyQuery = queryClient.query(empty.queryOptions());
const explicitQuery = queryClient.query(explicit.queryOptions());
true satisfies Assert<Equal<Awaited<typeof emptyQuery>, null>>;
true satisfies Assert<Equal<Awaited<typeof explicitQuery>, null>>;
const emptyMetadata = queryClient.query(empty.metadataOptions());
const explicitMetadata = queryClient.query(explicit.metadataOptions());
true satisfies Assert<Equal<Awaited<typeof emptyMetadata>["data"], null>>;
true satisfies Assert<Equal<Awaited<typeof explicitMetadata>["data"], null>>;
const emptyMutation = empty.mutationOptions().mutationFn();
const explicitMutation = explicit.mutationOptions().mutationFn();
true satisfies Assert<Equal<Awaited<typeof emptyMutation>, void>>;
true satisfies Assert<Equal<Awaited<typeof explicitMutation>, void>>;
empty.infiniteOptions({
  initialPageParam: 0,
  getNextPageParam: () => undefined,
});
explicit.infiniteOptions({
  initialPageParam: 0,
  getNextPageParam: () => undefined,
});

// @ts-expect-error Empty success declarations have no live view.
empty.liveOptions();
// @ts-expect-error Empty success declarations have no accumulated view.
empty.streamedOptions({ maxChunks: "unbounded" });
// @ts-expect-error Explicit NoContent declarations have no live view.
explicit.liveOptions();
// @ts-expect-error Explicit NoContent declarations have no accumulated view.
explicit.streamedOptions({ maxChunks: "unbounded" });
