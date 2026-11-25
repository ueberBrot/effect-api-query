import {
  Context,
  Equal,
  Predicate,
  RegExp as EffectRegExp,
  Schema,
  SchemaAST,
} from "effect";
import { Headers, HttpMethod } from "effect/http";
import { HttpApi } from "effect/http-api";
import type { HttpApiEndpoint } from "effect/http-api";

import {
  canonicalize,
  canonicalizeOmittingUndefined,
} from "../core/canonical-key";
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

const isEmptyWireAst = (ast: SchemaAST.AST): boolean =>
  SchemaAST.isUndefined(ast) || SchemaAST.isVoid(ast) || SchemaAST.isNever(ast);

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
    if (!nested || prefix.length === 0 || isEmptyWireAst(ast)) {
      return "Safe";
    }
    return matchesQueryRedaction(formatWireName(prefix), patterns)
      ? "RequiresEncoder"
      : "Safe";
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
    if (!nested) {
      if (matchesHeaderRedaction(formatWireName(nextPath), patterns)) {
        return "RequiresEncoder";
      }
      continue;
    }
    result = mergeRedactionAnalysis(
      result,
      inspectRedactedAst(property.type, patterns, true, nextPath, seen)
    );
    if (result === "RequiresEncoder") {
      return result;
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
  const encoders = parts.map(
    ({ part, schema, options }) =>
      [part, createSchemaKeyEncoding(schema, options)] as const
  );
  const requiresEncoder =
    encoders.some(([, encoding]) => encoding.requiresEncoder) ||
    redactedAnalysis !== "Safe";
  const cacheable =
    encoders.every(([, encoding]) => encoding.cacheable) &&
    redactedAnalysis !== "Retry";
  return {
    requiresEncoder,
    cacheable,
    encode: (input) => {
      if (!Predicate.isObject(input)) {
        throw new TypeError("HTTP request input must be an object");
      }
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
      const encoded: Record<string, unknown> = {};
      for (const [part, encoding] of encoders) {
        encoded[part] = encoding.encode(input[part]);
      }
      return encoded;
    },
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
  redactedPatterns: readonly (string | RegExp)[],
  seen: WeakSet<object>
): JsonValue => {
  if (seen.has(rawHeaders)) {
    throw new TypeError("Key values must not contain cycles");
  }
  seen.add(rawHeaders);

  const prototype: unknown = Object.getPrototypeOf(rawHeaders);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Key values must contain only plain objects");
  }

  const lowered = new Map<string, JsonValue>();
  for (const name of Object.keys(rawHeaders)) {
    const headerValue = rawHeaders[name];
    if (headerValue === undefined) {
      continue;
    }
    if (matchesHeaderRedaction(name, redactedPatterns)) {
      throw new TypeError("Redacted HTTP headers require a custom key encoder");
    }

    const lower = name.toLowerCase();
    if (lower === "__proto__" || lower === "constructor") {
      throw new TypeError(
        "Key objects must not contain __proto__ or constructor properties"
      );
    }

    const canonicalValue = canonicalizeOmittingUndefined(headerValue, seen);
    const existing = lowered.get(lower);
    if (existing !== undefined && !Equal.equals(existing, canonicalValue)) {
      throw new TypeError(
        "Encoded header names must not have conflicting values"
      );
    }
    lowered.set(lower, canonicalValue);
  }
  seen.delete(rawHeaders);

  const sortedKeys = [...lowered.keys()];
  sortedKeys.sort();
  const headers: Record<string, JsonValue> = {};
  for (const key of sortedKeys) {
    const entry = lowered.get(key);
    if (entry !== undefined) {
      headers[key] = entry;
    }
  }
  return Object.freeze(headers);
};

const normalizeRequestKey = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  options: RequestNormalizationOptions
): JsonValue => {
  if (!Predicate.isObject(value)) {
    throw new TypeError("Encoded HTTP requests must be objects");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Key values must contain only plain objects");
  }

  const seen = new WeakSet();
  seen.add(value);

  const keys = Object.keys(value);
  keys.sort();
  const canonical: Record<string, JsonValue> = {};
  for (const key of keys) {
    const item = value[key];
    if (item === undefined) {
      continue;
    }
    if (key === "__proto__" || key === "constructor") {
      throw new TypeError(
        "Key objects must not contain __proto__ or constructor properties"
      );
    }

    if (key === "headers" && Predicate.isObject(item)) {
      canonical[key] = normalizeHeaders(
        item,
        options.redactedNames.headers,
        seen
      );
    } else if (key === "query") {
      const cleaned = omitUndefined(item, seen);
      canonical[key] = canonicalize(
        normalizeUrlEncodedPart(cleaned, options.redactedNames.query),
        seen
      );
    } else if (key === "payload" && options.urlEncodedPayload) {
      const cleaned = omitUndefined(item, seen);
      canonical[key] = canonicalize(
        normalizeUrlEncodedPart(
          cleaned,
          options.redactPayloadAsQuery ? options.redactedNames.query : []
        ),
        seen
      );
    } else {
      canonical[key] = canonicalizeOmittingUndefined(item, seen);
    }
  }

  seen.delete(value);
  return Object.freeze(canonical);
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
    fields["payload"] =
      payloads.length === 1 && payloads[0] !== undefined
        ? payloads[0]
        : Schema.Union(payloads);
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
        if (encoder) {
          return { input, keyValue };
        }
        try {
          return {
            input,
            keyValue: normalizeRequestKey(keyValue, normalization),
            canonical: true as const,
          };
        } catch (error) {
          throw invalidKey(error);
        }
      },
    },
  };
};
