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

export type QueryableHttpEndpoint =
  | {
      readonly kind: "Unary";
      readonly payloads: readonly Schema.Top[];
      readonly successes: readonly Schema.Top[];
    }
  | {
      readonly kind: "Streaming";
      readonly payloads: readonly Schema.Top[];
      readonly stream: "StreamSse" | "StreamNdjson";
      readonly success: Schema.Top;
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
    const body = HttpApiSchema.isWithHeaders(success)
      ? success.schema
      : success;
    if (Predicate.hasProperty(body, "~effect/http-api/HttpApiSchema/Upgrade")) {
      return undefined;
    }
    if (Predicate.hasProperty(body, "~effect/http-api/HttpApiSchema/Stream")) {
      if (
        multipart ||
        successes.size !== 1 ||
        !Predicate.hasProperty(body, "_tag") ||
        (body._tag !== "StreamSse" && body._tag !== "StreamNdjson")
      ) {
        return undefined;
      }
      return { kind: "Streaming", stream: body._tag, payloads, success };
    }
  }
  return multipart
    ? { kind: "Mutation" }
    : { kind: "Unary", payloads, successes: [...successes] };
};
