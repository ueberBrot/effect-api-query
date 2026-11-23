import { Predicate, Schema } from "effect";
import { HttpApiSchema } from "effect/http-api";
import type { HttpApiEndpoint } from "effect/http-api";

const multipartBrands = (schema: Schema.Top) => {
  let buffered = false;
  let streamed = false;
  const visited = new WeakSet();
  let current: unknown = schema;
  while (Schema.isSchema(current) && !visited.has(current)) {
    visited.add(current);
    if (Predicate.hasProperty(current, "identifier")) {
      buffered ||= current.identifier === HttpApiSchema.MultipartTypeId;
      streamed ||= current.identifier === HttpApiSchema.MultipartStreamTypeId;
    }
    current = Predicate.hasProperty(current, "schema")
      ? current.schema
      : undefined;
  }
  return { buffered, streamed };
};

const unwrapSuccess = (success: Schema.Top) =>
  HttpApiSchema.isWithHeaders(success)
    ? { body: success.schema, headers: success.headers }
    : { body: success, headers: undefined };

const isStreamSchema = (
  schema: Schema.Top
): schema is HttpApiSchema.StreamSchema =>
  Predicate.hasProperty(schema, "~effect/http-api/HttpApiSchema/Stream");

export type QueryableHttpEndpoint =
  | {
      readonly kind: "Unary";
      readonly payloads: readonly Schema.Top[];
      readonly successes: readonly Schema.Top[];
    }
  | {
      readonly kind: "Streaming";
      readonly payloads: readonly Schema.Top[];
      readonly stream: Extract<
        HttpApiSchema.StreamSchema,
        { readonly _tag: "StreamSse" | "StreamNdjson" }
      >;
      readonly headers: Schema.Top | undefined;
    };

export const classifyHttpEndpoint = (
  endpoint: HttpApiEndpoint.Top
):
  | QueryableHttpEndpoint
  | { readonly kind: "Mutation" }
  | { readonly kind: "ContradictoryMultipart" }
  | undefined => {
  const payloads: Schema.Top[] = [];
  let multipart = false;
  let multipartStream = false;
  for (const { encoding, schemas } of endpoint.payload.values()) {
    if (encoding._tag === "Stream") {
      return undefined;
    }
    const mode = encoding._tag === "Multipart" ? encoding.mode : undefined;
    const expectedBuffered = mode === "buffered";
    const expectedStreamed = mode === "stream";
    for (const schema of schemas) {
      const { buffered, streamed } = multipartBrands(schema);
      if (buffered !== expectedBuffered || streamed !== expectedStreamed) {
        return { kind: "ContradictoryMultipart" };
      }
      multipart ||= expectedBuffered;
      multipartStream ||= expectedStreamed;
      payloads.push(schema);
    }
  }
  if (multipartStream) {
    return undefined;
  }
  const { success: successes } = endpoint;
  for (const success of successes) {
    const { body, headers } = unwrapSuccess(success);
    if (Predicate.hasProperty(body, "~effect/http-api/HttpApiSchema/Upgrade")) {
      return undefined;
    }
    if (isStreamSchema(body)) {
      if (
        multipart ||
        successes.size !== 1 ||
        (body._tag !== "StreamSse" && body._tag !== "StreamNdjson")
      ) {
        return undefined;
      }
      return {
        kind: "Streaming",
        stream: body,
        headers,
        payloads,
      };
    }
  }
  return multipart
    ? { kind: "Mutation" }
    : { kind: "Unary", payloads, successes: [...successes] };
};
