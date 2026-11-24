import { Predicate, Schema } from "effect";
import type { SchemaAST } from "effect";
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

const findStatusAnnotation = (
  ast: SchemaAST.AST | SchemaAST.FilterGroup<unknown>
): Schema.Annotations.Annotations | undefined => {
  const checks = ast.checks ?? [];
  for (let index = checks.length - 1; index >= 0; index -= 1) {
    const check = checks[index];
    if (check === undefined) {
      continue;
    }
    if (
      check.annotations !== undefined &&
      "httpApiStatus" in check.annotations
    ) {
      return check.annotations;
    }
    if (check._tag === "FilterGroup") {
      const annotations = findStatusAnnotation(check);
      if (annotations !== undefined) {
        return annotations;
      }
    }
  }
  const { annotations } = ast;
  return annotations && "httpApiStatus" in annotations
    ? annotations
    : undefined;
};

const readStatus = (ast: SchemaAST.AST): number | undefined => {
  const annotations = findStatusAnnotation(ast);
  if (annotations === undefined) {
    return ast.context?.annotations?.httpApiStatus;
  }
  const { httpApiStatus } = annotations;
  return Predicate.isNumber(httpApiStatus) ? httpApiStatus : undefined;
};

export const groupBufferedSuccessesByStatus = (
  successes: readonly Schema.Top[]
) => {
  const byStatus = new Map<number, Schema.Top[]>();
  for (const schema of successes.length === 0
    ? [HttpApiSchema.NoContent]
    : successes) {
    const status =
      readStatus(schema.ast) ??
      (HttpApiSchema.isWithHeaders(schema)
        ? readStatus(schema.schema.ast)
        : undefined) ??
      200;
    const members = byStatus.get(status);
    if (members === undefined) {
      byStatus.set(status, [schema]);
    } else {
      members.push(schema);
    }
  }
  return byStatus;
};

const isStreamSchema = (
  schema: Schema.Top
): schema is HttpApiSchema.StreamSchema =>
  Predicate.hasProperty(schema, "~effect/http-api/HttpApiSchema/Stream");

export type QueryableHttpEndpoint =
  | {
      readonly kind: "Unary";
      readonly payloads: readonly Schema.Top[];
      readonly payloadEncoding:
        | HttpApiSchema.PayloadEncoding["_tag"]
        | undefined;
      readonly successes: readonly Schema.Top[];
    }
  | {
      readonly kind: "Streaming";
      readonly payloads: readonly Schema.Top[];
      readonly payloadEncoding:
        | HttpApiSchema.PayloadEncoding["_tag"]
        | undefined;
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
  let payloadEncoding: HttpApiSchema.PayloadEncoding["_tag"] | undefined;
  let multipart = false;
  let multipartStream = false;
  for (const { encoding, schemas } of endpoint.payload.values()) {
    if (encoding._tag === "Stream") {
      return undefined;
    }
    payloadEncoding ??= encoding._tag;
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
        payloadEncoding,
      };
    }
  }
  return multipart
    ? { kind: "Mutation" }
    : {
        kind: "Unary",
        payloads,
        payloadEncoding,
        successes: [...successes],
      };
};
