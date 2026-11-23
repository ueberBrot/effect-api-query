import { Context, Predicate, Schema } from "effect";
import { HttpApi } from "effect/http-api";
import type { HttpApiEndpoint } from "effect/http-api";

import { canonicalize } from "../core/canonical-key";
import type { OperationInput } from "../core/operation";
import { createSchemaKeyEncoding } from "../core/schema-key";
import type { SchemaKeyEncoding } from "../core/schema-key";
import type { JsonValue } from "../core/types";
import { classifyHttpEndpoint } from "./endpoint";
import {
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryKeyError,
} from "./errors";
import type { HttpApiEndpointIdentity } from "./errors";

export type HttpRequestDescription = (
  | { readonly kind: "Unary"; readonly input: OperationInput }
  | {
      readonly kind: "Streaming";
      readonly stream: "StreamSse" | "StreamNdjson";
      readonly input: OperationInput;
    }
  | { readonly kind: "Mutation" }
) & { readonly parts: readonly string[] };

const requestParts = ["params", "query", "headers", "payload"] as const;
type RequestFields = Partial<Record<(typeof requestParts)[number], Schema.Top>>;

const requestKeyEncoding = (
  fields: RequestFields,
  annotations: Context.Context<never>
): SchemaKeyEncoding => {
  const fallback = Context.getOrUndefined(annotations, HttpApi.ParseOptions);
  const overrides = {
    params: Context.getOrUndefined(annotations, HttpApi.ParamsParseOptions),
    query: Context.getOrUndefined(annotations, HttpApi.QueryParseOptions),
    headers: Context.getOrUndefined(annotations, HttpApi.HeadersParseOptions),
    payload: Context.getOrUndefined(annotations, HttpApi.PayloadParseOptions),
  };
  const parts = requestParts.flatMap((part) => {
    const schema = fields[part];
    const options = overrides[part] ?? fallback;
    return schema === undefined ? [] : [{ part, schema, options }];
  });
  if (parts.every(({ options }) => options === undefined)) {
    return createSchemaKeyEncoding(Schema.Struct(fields));
  }
  const encoders = parts.map(
    ({ part, schema, options }) =>
      [part, createSchemaKeyEncoding(schema, options)] as const
  );
  return {
    requiresEncoder: encoders.some(([, encoding]) => encoding.requiresEncoder),
    cacheable: encoders.every(([, encoding]) => encoding.cacheable),
    encode: (input) => {
      if (!Predicate.isObject(input)) {
        throw new TypeError("HTTP request input must be an object");
      }
      return Object.fromEntries(
        encoders.map(([part, encoding]) => [part, encoding.encode(input[part])])
      );
    },
  };
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns
const omitUndefined = (value: unknown, seen = new WeakSet()): unknown => {
  if (!Predicate.isObjectOrArray(value)) {
    return value;
  }
  if (seen.has(value)) {
    throw new TypeError("Key values must not contain cycles");
  }
  seen.add(value);
  let result: unknown = value;
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError("Key values must not contain sparse arrays");
      }
      const item = value[index];
      const next = omitUndefined(item, seen);
      if (copy !== undefined) {
        copy.push(next);
      } else if (next !== item) {
        copy = Array.from({ length: index }, (_, offset) => value[offset]);
        copy.push(next);
      }
    }
    result = copy ?? value;
  } else if (
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null
  ) {
    let copy: [string, unknown][] | undefined;
    const entries = Object.entries(value);
    for (const [index, [name, item]] of entries.entries()) {
      if (item === undefined) {
        copy ??= entries.slice(0, index);
      } else {
        const next = omitUndefined(item, seen);
        if (next !== item) {
          copy ??= entries.slice(0, index);
        }
        copy?.push([name, next]);
      }
    }
    result = copy === undefined ? value : Object.fromEntries(copy);
  }
  seen.delete(value);
  return result;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters
const normalizeRequestKey = (value: unknown) => {
  const request = omitUndefined(value);
  if (!Predicate.isObject(request)) {
    throw new TypeError("Encoded HTTP requests must be objects");
  }
  if (Predicate.isObject(request["headers"])) {
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    const headers: Record<string, JsonValue> = Object.create(null);
    for (const [name, headerValue] of Object.entries(request["headers"])) {
      const lower = name.toLowerCase();
      const canonicalValue = canonicalize(headerValue);
      if (
        Object.hasOwn(headers, lower) &&
        JSON.stringify(headers[lower]) !== JSON.stringify(canonicalValue)
      ) {
        throw new TypeError(
          "Encoded header names must not have conflicting values"
        );
      }
      headers[lower] = canonicalValue;
    }
    return { ...request, headers };
  }
  return request;
};

export const createHttpRequest = (
  endpoint: HttpApiEndpoint.Top,
  identity: HttpApiEndpointIdentity,
  annotations: Context.Context<never>
): HttpRequestDescription | undefined => {
  const classified = classifyHttpEndpoint(endpoint);
  if (classified === undefined) {
    return undefined;
  }
  if (classified.kind === "ContradictoryMultipart") {
    throw new EffectHttpApiQueryConfigError(
      "UnsupportedEndpointMetadata",
      `HTTP endpoint ${identity.groupId}/${identity.endpoint} has contradictory multipart metadata`,
      identity
    );
  }
  const fields: RequestFields = {};
  if (endpoint.params !== undefined) {
    fields["params"] = endpoint.params;
  }
  if (endpoint.query !== undefined) {
    fields["query"] = endpoint.query;
  }
  if (endpoint.headers !== undefined) {
    fields["headers"] = endpoint.headers;
  }
  if (classified.kind === "Mutation") {
    return {
      kind: classified.kind,
      parts: [...Object.keys(fields), "payload"],
    };
  }
  const { payloads } = classified;
  if (payloads.length > 0) {
    fields["payload"] = Schema.Union(payloads);
  }
  const parts = Object.keys(fields);
  const description =
    classified.kind === "Streaming"
      ? { kind: classified.kind, stream: classified.stream._tag, parts }
      : { kind: classified.kind, parts };
  if (parts.length === 0) {
    return { ...description, input: { _tag: "Inputless" } };
  }
  const keyEncoding = requestKeyEncoding(fields, annotations);
  const invalidKey = (cause: unknown) =>
    new EffectHttpApiQueryKeyError(
      "InvalidKeyValue",
      identity,
      `The HTTP key for ${identity.groupId}/${identity.endpoint} is not JSON-safe`,
      cause
    );
  return {
    ...description,
    input: {
      _tag: "Input",
      requiresEncoder: payloads.length > 1 || keyEncoding.requiresEncoder,
      cacheable: keyEncoding.cacheable,
      pageInput: (input) => input,
      invalidKey,
      prepare: (input, encoder) => {
        let keyValue: unknown;
        try {
          keyValue = encoder ? encoder(input) : keyEncoding.encode(input);
        } catch (error) {
          throw new EffectHttpApiQueryKeyError(
            encoder ? "KeyEncoderFailed" : "RequestEncodingFailed",
            identity,
            `Could not encode the HTTP key for ${identity.groupId}/${identity.endpoint}`,
            error
          );
        }
        try {
          return {
            input,
            keyValue: encoder ? keyValue : normalizeRequestKey(keyValue),
          };
        } catch (error) {
          throw invalidKey(error);
        }
      },
    },
  };
};
