import { QueryClient, QueryObserver, skipToken } from "@tanstack/query-core";
import {
  configureUtils,
  createHttpApiQueryUtils,
  type CreateHttpApiQueryUtilsOptions,
  type EffectHttpApiQueryConfigError,
  type EffectHttpApiQueryEmptyStreamError,
  type EffectHttpApiQueryError,
  type InferInput,
  type InferQueryData,
  type InferQueryError,
  type RunPromiseExit,
} from "@ueberbrot/effect-api-query";
import {
  Context,
  Effect,
  Schema,
  SchemaTransformation,
  type Stream,
} from "effect";
import type { HttpClientError } from "effect/http";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  type HttpApiClient,
} from "effect/http-api";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

class DecodeRecord extends Context.Service<
  DecodeRecord,
  { readonly factor: number }
>()("Ndjson/DecodeRecord") {}
const Record = Schema.Struct({ id: Schema.FiniteFromString }).pipe(
  Schema.decodeTo(
    Schema.Struct({ id: Schema.Finite }),
    SchemaTransformation.transformEffect({
      decode: (record) =>
        DecodeRecord.pipe(
          Effect.map(({ factor }) => ({ id: record.id * factor }))
        ),
      encode: Effect.succeed,
    })
  )
);
const Watch = HttpApiEndpoint.post("watch", "/watch/:id", {
  params: { id: Schema.FiniteFromString },
  query: { channel: Schema.String },
  headers: { "x-version": Schema.FiniteFromString },
  payload: Schema.Struct({ after: Schema.FiniteFromString }),
  success: HttpApiSchema.StreamNdjson({
    schema: Record,
    maxElementBytes: "2 MiB",
  }),
  error: Schema.TaggedStruct("Denied", { reason: Schema.String }),
});
const Wrapped = HttpApiEndpoint.get("wrapped", "/wrapped", {
  success: HttpApiSchema.WithHeaders(
    HttpApiSchema.StreamNdjson({ schema: Record }),
    { "x-version": Schema.FiniteFromString }
  ),
});
const Union = HttpApiEndpoint.get("union", "/union", {
  success: HttpApiSchema.StreamNdjson({
    schema: Schema.Union([Schema.Finite, Schema.String]),
  }),
});
const Mixed = HttpApiEndpoint.get("mixed", "/mixed", {
  success: [
    HttpApiSchema.StreamNdjson({ schema: Record }),
    HttpApiSchema.StreamSse({ data: Schema.String }).pipe(
      HttpApiSchema.status(201)
    ),
  ],
});
const Multiple = HttpApiEndpoint.get("multiple", "/multiple", {
  success: [
    HttpApiSchema.StreamNdjson({ schema: Schema.String }),
    HttpApiSchema.StreamNdjson({ schema: Schema.Finite }).pipe(
      HttpApiSchema.status(201)
    ),
  ],
});
const Multipart = HttpApiEndpoint.post("multipart", "/multipart", {
  payload: Schema.Struct({ file: Schema.String }).pipe(
    HttpApiSchema.asMultipart()
  ),
  success: HttpApiSchema.StreamNdjson({ schema: Schema.String }),
});
const api = HttpApi.make("ndjson-types").add(
  HttpApiGroup.make("records").add(Watch, Mixed, Multiple, Multipart),
  HttpApiGroup.make("system", { topLevel: true }).add(Wrapped, Union)
);
declare const client: HttpApiClient.ForApi<
  typeof api,
  "client-error",
  "client-service"
>;
declare const runPromiseExit: RunPromiseExit<DecodeRecord | "client-service">;
const input = {
  params: { id: 1 },
  query: { channel: "news" },
  headers: { "x-version": 2 },
  payload: { after: 3 },
};
const decoded = client.records.watch({
  ...input,
  responseMode: "decoded-only",
});
type DecodedStream = Effect.Success<typeof decoded>;
true satisfies Assert<
  Equal<Stream.Success<DecodedStream>, { readonly id: number }>
>;
true satisfies Assert<
  Equal<
    Stream.Error<DecodedStream>,
    HttpClientError.HttpClientError | Schema.SchemaError
  >
>;
true satisfies Assert<Equal<Stream.Services<DecodedStream>, never>>;
true satisfies Assert<
  Equal<Effect.Services<typeof decoded>, DecodeRecord | "client-service">
>;
const decodedWrapped = client.wrapped({ responseMode: "decoded-only" });
true satisfies Assert<
  Equal<
    Stream.Success<Effect.Success<typeof decodedWrapped>["body"]>,
    { readonly id: number }
  >
>;
true satisfies Assert<
  Equal<
    Effect.Success<typeof decodedWrapped>["headers"],
    { readonly "x-version": number }
  >
>;

const http = createHttpApiQueryUtils(api, {
  client,
  keyPrefix: ["ndjson"],
  runPromiseExit,
});
true satisfies Assert<Equal<keyof typeof http.records, "key" | "watch">>;
true satisfies Assert<
  Equal<
    keyof typeof http.records.watch,
    "key" | "streamedKey" | "streamedOptions" | "liveKey" | "liveOptions"
  >
>;
input satisfies InferInput<typeof http.records.watch>;
true satisfies Assert<
  Equal<
    InferQueryData<typeof http.records.watch, "streamed">,
    readonly { readonly id: number }[]
  >
>;
true satisfies Assert<
  Equal<
    InferQueryData<typeof http.records.watch, "live">,
    { readonly id: number }
  >
>;
type Failure =
  | EffectHttpApiQueryConfigError
  | EffectHttpApiQueryError<
      | "client-error"
      | { readonly _tag: "Denied"; readonly reason: string }
      | HttpClientError.HttpClientError
      | Schema.SchemaError
    >;
true satisfies Assert<
  Equal<InferQueryError<typeof http.records.watch, "streamed">, Failure>
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof http.records.watch, "live">,
    Failure | EffectHttpApiQueryEmptyStreamError
  >
>;
const queryClient = new QueryClient();
true satisfies Assert<
  Equal<
    InferQueryData<typeof http.union, "streamed">,
    readonly (number | string)[]
  >
>;
const options = http.records.watch.streamedOptions({
  input,
  maxChunks: 3,
  select: (records) => records.map((record) => record.id),
});
const observer = new QueryObserver(queryClient, options);
true satisfies Assert<
  Equal<
    ReturnType<typeof observer.getCurrentResult>["data"],
    number[] | undefined
  >
>;
const wrapped = queryClient.getQueryData(http.wrapped.liveKey());
true satisfies Assert<
  Equal<
    InferQueryError<typeof http.wrapped, "live">,
    | EffectHttpApiQueryConfigError
    | EffectHttpApiQueryEmptyStreamError
    | EffectHttpApiQueryError<
        "client-error" | HttpClientError.HttpClientError | Schema.SchemaError
      >
  >
>;
true satisfies Assert<
  Equal<
    typeof wrapped,
    | HttpApiSchema.withHeaders<
        { readonly id: number },
        { readonly "x-version": number }
      >
    | undefined
  >
>;
http.records.watch.streamedOptions({ input: skipToken, maxChunks: "unbounded" })
  .queryFn satisfies typeof skipToken;
const configured = configureUtils(http, {
  streamed: { policy: { maxChunks: 2 } },
});
configured.records.watch.streamedOptions({ input });
configured.records.watch.streamedKey(input);
http.records.watch.liveKey(input);
const ssePolicy = { maxChunks: 2, sseOptions: { maxEventSize: 100 } };
// @ts-expect-error NDJSON has no SSE decoder controls, including captured policies.
http.records.watch.streamedKey(input, ssePolicy);
// @ts-expect-error NDJSON has no SSE decoder controls.
http.records.watch.liveOptions({ input, sseOptions: {} });
// @ts-expect-error NDJSON has no SSE decoder controls on inputless views.
http.wrapped.liveKey({ sseOptions: {} });
const perCallLimit = {
  input,
  maxChunks: 2,
  maxElementBytes: 1024,
};
// @ts-expect-error Stream decoding limits belong to the Effect declaration.
http.records.watch.streamedOptions(perCallLimit);
const encodedInput = {
  input: { ...input, payload: { after: "3" } },
};
// @ts-expect-error Request fields use decoded values.
http.records.watch.liveOptions(encodedInput);
// @ts-expect-error Stream endpoints have no buffered metadata view.
http.records.watch.metadataOptions({ input });
// @ts-expect-error Decoding and client services require a runner.
createHttpApiQueryUtils(api, { client, keyPrefix: ["missing"] });

declare const extraClient: HttpApiClient.ForApi<typeof api> & {
  readonly records: {
    readonly watch: (
      request: typeof input & { readonly responseMode: "decoded-only" }
    ) => Effect.Effect<
      Stream.Stream<{ readonly id: number }, "stream-error", "stream-service">,
      "extra-error",
      DecodeRecord | "extra-service"
    >;
  };
};
declare const extraRunner: RunPromiseExit<
  DecodeRecord | "extra-service" | "stream-service"
>;
const extra = createHttpApiQueryUtils(api, {
  client: extraClient,
  keyPrefix: ["extra"],
  runPromiseExit: extraRunner,
});
type ExtraFailure =
  Exclude<
    InferQueryError<typeof extra.records.watch, "streamed">,
    EffectHttpApiQueryConfigError
  > extends EffectHttpApiQueryError<infer Error>
    ? Error
    : never;
true satisfies Assert<
  Equal<
    Extract<ExtraFailure, "extra-error" | "stream-error">,
    "extra-error" | "stream-error"
  >
>;
true satisfies Assert<
  Equal<
    CreateHttpApiQueryUtilsOptions<
      typeof api,
      readonly ["extra"],
      typeof extraClient
    >["runPromiseExit"],
    typeof extraRunner
  >
>;
