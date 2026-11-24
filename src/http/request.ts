import {
  Context,
  Predicate,
  RegExp as EffectRegExp,
  Schema,
  SchemaAST,
} from "effect";
import { Headers, HttpMethod } from "effect/http";
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
type RedactionAnalysis = "Safe" | "RequiresEncoder" | "Retry";

interface EndpointRedactedNames {
  readonly query: readonly (string | RegExp)[];
  readonly headers: readonly (string | RegExp)[];
}

interface RequestNormalizationOptions {
  readonly redactedNames: EndpointRedactedNames;
  readonly urlEncodedPayload: boolean;
  readonly redactPayloadAsQuery: boolean;
}

const formatWireName = (path: readonly string[]): string => {
  const [first, ...rest] = path;
  if (first === undefined) {
    return "";
  }
  return rest.length === 0 ? first : `${first}[${rest.join("][")}]`;
};

const collectRedactedNames = (
  annotationContexts: readonly Context.Context<never>[]
): EndpointRedactedNames => {
  const query: (string | RegExp)[] = [];
  const headers: (string | RegExp)[] = [];
  for (const annotations of annotationContexts) {
    const options = Context.getOrUndefined(annotations, HttpApi.RedactedNames);
    if (options === undefined) {
      continue;
    }
    for (const name of options.query ?? []) {
      query.push(name);
      if (Predicate.isString(name)) {
        query.push(new RegExp(`^${EffectRegExp.escape(name)}\\[`, "iu"));
      }
    }
    if (options.headers !== undefined) {
      headers.push(...options.headers);
    }
  }
  return { query, headers };
};

const mergeRedactionAnalysis = (
  left: RedactionAnalysis,
  right: RedactionAnalysis
): RedactionAnalysis => {
  if (left === "RequiresEncoder" || right === "RequiresEncoder") {
    return "RequiresEncoder";
  }
  if (left === "Retry" || right === "Retry") {
    return "Retry";
  }
  return "Safe";
};

const toUnicodeScalarString = (value: string): string => {
  let result = "";
  let changed = false;
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && code >= 0xd8_00 && code <= 0xdf_ff) {
      result += "\uFFFD";
      changed = true;
    } else {
      result += char;
    }
  }
  return changed ? result : value;
};

const matchesHeaderRedaction = (
  name: string,
  patterns: readonly (string | RegExp)[]
): boolean =>
  patterns.length > 0 &&
  (Headers.isRedactedName(name, patterns) ||
    Headers.isRedactedName(name.toLowerCase(), patterns));

const matchesQueryRedaction = (
  wireName: string,
  patterns: readonly (string | RegExp)[]
): boolean => {
  if (patterns.length === 0) {
    return false;
  }
  const wellFormed = toUnicodeScalarString(wireName);
  return (
    Headers.isRedactedName(wireName, patterns) ||
    (wellFormed !== wireName && Headers.isRedactedName(wellFormed, patterns))
  );
};

const isOpenRedactedAst = (
  ast: SchemaAST.AST,
  nested: boolean,
  prefixLength: number
): boolean =>
  SchemaAST.isAny(ast) ||
  SchemaAST.isUnknown(ast) ||
  SchemaAST.isObjectKeyword(ast) ||
  SchemaAST.isDeclaration(ast) ||
  (nested && prefixLength === 0 && SchemaAST.isArrays(ast));

const inspectRedactedAst = (
  ast: SchemaAST.AST,
  patterns: readonly (string | RegExp)[],
  nested: boolean,
  prefix: readonly string[],
  seen: Set<SchemaAST.AST>
): RedactionAnalysis => {
  if (isOpenRedactedAst(ast, nested, prefix.length)) {
    return "RequiresEncoder";
  }
  if (SchemaAST.isUnion(ast)) {
    let result: RedactionAnalysis = "Safe";
    for (const member of ast.types) {
      result = mergeRedactionAnalysis(
        result,
        inspectRedactedAst(member, patterns, nested, prefix, seen)
      );
      if (result === "RequiresEncoder") {
        return result;
      }
    }
    return result;
  }
  if (SchemaAST.isSuspend(ast)) {
    if (seen.has(ast)) {
      return "Safe";
    }
    seen.add(ast);
    try {
      return inspectRedactedAst(ast.thunk(), patterns, nested, prefix, seen);
    } catch {
      return "Retry";
    } finally {
      seen.delete(ast);
    }
  }
  if (!SchemaAST.isObjects(ast)) {
    return "Safe";
  }
  if (ast.indexSignatures.length > 0) {
    return "RequiresEncoder";
  }
  let result: RedactionAnalysis = "Safe";
  for (const property of ast.propertySignatures) {
    if (Predicate.isSymbol(property.name)) {
      continue;
    }
    const nextPath = [...prefix, String(property.name)];
    const wireName = formatWireName(nextPath);
    if (
      nested
        ? matchesQueryRedaction(wireName, patterns)
        : matchesHeaderRedaction(wireName, patterns)
    ) {
      return "RequiresEncoder";
    }
    if (nested) {
      result = mergeRedactionAnalysis(
        result,
        inspectRedactedAst(property.type, patterns, true, nextPath, seen)
      );
      if (result === "RequiresEncoder") {
        return result;
      }
    }
  }
  return result;
};

const inspectSchemaRedaction = (
  schema: Schema.Top | undefined,
  patterns: readonly (string | RegExp)[],
  nested: boolean
): RedactionAnalysis => {
  if (schema === undefined || patterns.length === 0) {
    return "Safe";
  }
  return inspectRedactedAst(
    SchemaAST.toEncoded(schema.ast),
    patterns,
    nested,
    [],
    new Set()
  );
};

const requestKeyEncoding = (
  fields: RequestFields,
  annotations: Context.Context<never>,
  redactedNames: EndpointRedactedNames,
  redactPayloadAsQuery: boolean
): SchemaKeyEncoding => {
  const fallback = Context.getOrUndefined(annotations, HttpApi.ParseOptions);
  const overrides = {
    params: Context.getOrUndefined(annotations, HttpApi.ParamsParseOptions),
    query: Context.getOrUndefined(annotations, HttpApi.QueryParseOptions),
    headers: Context.getOrUndefined(annotations, HttpApi.HeadersParseOptions),
    payload: Context.getOrUndefined(annotations, HttpApi.PayloadParseOptions),
  };
  const redactedAnalysis = mergeRedactionAnalysis(
    mergeRedactionAnalysis(
      inspectSchemaRedaction(fields.headers, redactedNames.headers, false),
      inspectSchemaRedaction(fields.query, redactedNames.query, true)
    ),
    redactPayloadAsQuery
      ? inspectSchemaRedaction(fields.payload, redactedNames.query, true)
      : "Safe"
  );
  const parts = requestParts.flatMap((part) => {
    const schema = fields[part];
    const options = overrides[part] ?? fallback;
    return schema === undefined ? [] : [{ part, schema, options }];
  });
  const baseEncoding: SchemaKeyEncoding = parts.every(
    ({ options }) => options === undefined
  )
    ? createSchemaKeyEncoding(Schema.Struct(fields))
    : (() => {
        const encoders = parts.map(
          ({ part, schema, options }) =>
            [part, createSchemaKeyEncoding(schema, options)] as const
        );
        return {
          requiresEncoder: encoders.some(
            ([, encoding]) => encoding.requiresEncoder
          ),
          cacheable: encoders.every(([, encoding]) => encoding.cacheable),
          encode: (input) => {
            if (!Predicate.isObject(input)) {
              throw new TypeError("HTTP request input must be an object");
            }
            return Object.fromEntries(
              encoders.map(([part, encoding]) => [
                part,
                encoding.encode(input[part]),
              ])
            );
          },
        };
      })();
  return {
    requiresEncoder:
      baseEncoding.requiresEncoder || redactedAnalysis !== "Safe",
    cacheable: baseEncoding.cacheable && redactedAnalysis !== "Retry",
    encode: baseEncoding.encode,
  };
};

const isPlainObject = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
): value is Record<string, unknown> =>
  Predicate.isObject(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

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
  } else if (isPlainObject(value)) {
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

interface WireParamEntry {
  readonly values: string[];
  sources: number;
}

const recordWireParam = (
  byName: Map<string, WireParamEntry>,
  wireName: string,
  value: string,
  newSource: boolean
) => {
  const existing = byName.get(wireName);
  if (existing === undefined) {
    byName.set(wireName, { values: [value], sources: 1 });
    return;
  }
  existing.values.push(value);
  if (newSource) {
    existing.sources += 1;
  }
};

const collectWireParams = (
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  record: Record<string, unknown>,
  prefix: readonly string[],
  byName: Map<string, WireParamEntry>,
  redactedPatterns: readonly (string | RegExp)[]
) => {
  for (const [key, item] of Object.entries(record)) {
    if (item === undefined) {
      continue;
    }
    const nextPath = [...prefix, key];
    const wireName = formatWireName(nextPath);
    const serializedName = toUnicodeScalarString(wireName);
    if (Array.isArray(item)) {
      let emitted = false;
      for (const element of item) {
        if (element === undefined) {
          continue;
        }
        if (!emitted && matchesQueryRedaction(wireName, redactedPatterns)) {
          throw new TypeError(
            "Redacted HTTP query parameters require a custom key encoder"
          );
        }
        recordWireParam(byName, serializedName, String(element), !emitted);
        emitted = true;
      }
    } else if (isPlainObject(item)) {
      collectWireParams(item, nextPath, byName, redactedPatterns);
    } else {
      if (matchesQueryRedaction(wireName, redactedPatterns)) {
        throw new TypeError(
          "Redacted HTTP query parameters require a custom key encoder"
        );
      }
      // oxlint-disable-next-line typescript/no-base-to-string
      recordWireParam(byName, serializedName, String(item), true);
    }
  }
};

const normalizeUrlEncodedPart = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  redactedPatterns: readonly (string | RegExp)[]
  // oxlint-disable-next-line anti-slop/no-unknown-returns
): unknown => {
  if (Array.isArray(value)) {
    if (redactedPatterns.length > 0) {
      for (const entry of value) {
        if (
          Array.isArray(entry) &&
          entry.length > 0 &&
          Predicate.isString(entry[0]) &&
          matchesQueryRedaction(entry[0], redactedPatterns)
        ) {
          throw new TypeError(
            "Redacted HTTP query parameters require a custom key encoder"
          );
        }
      }
    }
    return value;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const byName = new Map<string, WireParamEntry>();
  collectWireParams(value, [], byName, redactedPatterns);
  // oxlint-disable-next-line typescript/no-unsafe-assignment
  const collidingOrder: Record<string, readonly string[]> = Object.create(null);
  let hasCollision = false;
  for (const [wireName, entry] of byName) {
    if (entry.sources > 1) {
      collidingOrder[wireName] = entry.values;
      hasCollision = true;
    }
  }
  return hasCollision ? [value, collidingOrder] : value;
};

const normalizeHeaders = (
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  rawHeaders: Record<string, unknown>,
  redactedPatterns: readonly (string | RegExp)[]
): Record<string, JsonValue> => {
  // oxlint-disable-next-line typescript/no-unsafe-assignment
  const headers: Record<string, JsonValue> = Object.create(null);
  for (const [name, headerValue] of Object.entries(rawHeaders)) {
    if (matchesHeaderRedaction(name, redactedPatterns)) {
      throw new TypeError("Redacted HTTP headers require a custom key encoder");
    }
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
  return headers;
};

const normalizeRequestKey = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  options: RequestNormalizationOptions
) => {
  const request = omitUndefined(value);
  if (!Predicate.isObject(request)) {
    throw new TypeError("Encoded HTTP requests must be objects");
  }
  const headers = Predicate.isObject(request["headers"])
    ? normalizeHeaders(request["headers"], options.redactedNames.headers)
    : undefined;
  const query =
    "query" in request
      ? normalizeUrlEncodedPart(request["query"], options.redactedNames.query)
      : undefined;
  const payload =
    options.urlEncodedPayload && "payload" in request
      ? normalizeUrlEncodedPart(
          request["payload"],
          options.redactPayloadAsQuery ? options.redactedNames.query : []
        )
      : undefined;
  const hasQueryChange = "query" in request && query !== request["query"];
  const hasPayloadChange =
    options.urlEncodedPayload &&
    "payload" in request &&
    payload !== request["payload"];
  if (headers === undefined && !hasQueryChange && !hasPayloadChange) {
    return request;
  }
  return {
    ...request,
    ...(headers === undefined ? undefined : { headers }),
    ...(hasQueryChange ? { query } : undefined),
    ...(hasPayloadChange ? { payload } : undefined),
  };
};

export const createHttpRequest = (
  endpoint: HttpApiEndpoint.Top,
  identity: HttpApiEndpointIdentity,
  annotationLayers: readonly Context.Context<never>[]
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
  const { payloads, payloadEncoding } = classified;
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
  let annotations = Context.empty();
  for (const layer of annotationLayers) {
    annotations = Context.merge(annotations, layer);
  }
  const redactedNames = collectRedactedNames(annotationLayers);
  const redactPayloadAsQuery =
    fields.payload !== undefined && !HttpMethod.hasBody(endpoint.method);
  const urlEncodedPayload =
    fields.payload !== undefined &&
    (redactPayloadAsQuery || payloadEncoding === "FormUrlEncoded");
  const keyEncoding = requestKeyEncoding(
    fields,
    annotations,
    redactedNames,
    redactPayloadAsQuery
  );
  const normalization: RequestNormalizationOptions = {
    redactedNames,
    urlEncodedPayload,
    redactPayloadAsQuery,
  };
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
            keyValue: encoder
              ? keyValue
              : normalizeRequestKey(keyValue, normalization),
          };
        } catch (error) {
          throw invalidKey(error);
        }
      },
    },
  };
};
