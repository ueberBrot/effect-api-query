import {
  Array as EffectArray,
  Effect,
  Function,
  Predicate,
  Schema,
  SchemaAST,
  SchemaParser,
  SchemaTransformation,
} from "effect";
import { HttpApi, HttpApiSchema } from "effect/http-api";
import { Rpc, RpcSchema } from "effect/rpc";
import type { RpcGroup } from "effect/rpc";

import { classifyHttpEndpoint } from "../http/endpoint";
import type { QueryableHttpEndpoint } from "../http/endpoint";
import { canonicalizeArray } from "./canonical-key";
import type {
  HttpContractDecodingServices,
  HttpContractEncodingServices,
  HttpContractHydrationOptions,
  RpcContractDecodingServices,
  RpcContractEncodingServices,
  RpcContractHydrationOptions,
} from "./contract-hydration-types";
import {
  buildHydrationRegistry,
  compileHydrationCodec,
  HydrationCodecError,
} from "./hydration";
import type { CompiledHydrationCodec, HydrationRegistry } from "./hydration";
import type { QueryView } from "./inference";
import { isInvalidUtilitySegment } from "./operation";
import type { JsonValue } from "./types";

const rpcAllowedViews = new Set(["query", "live", "streamed"]);
const httpAllowedViews = new Set(["query", "metadata", "live", "streamed"]);

const UndefinedElementCodec =
  /* @__PURE__ */
  (() =>
    Schema.Tuple([Schema.Literal("undefined")]).pipe(
      Schema.decodeTo(
        Schema.Undefined,
        SchemaTransformation.transform({
          decode: Function.constUndefined,
          encode: () => ["undefined"] as const,
        })
      )
    ))();

const freezeMetadata = (data: unknown): unknown => {
  if (!Predicate.isObject(data)) {
    return data;
  }
  const { headers } = data;
  const snapshot =
    Predicate.isObject(headers) &&
    (!Object.isFrozen(headers) ||
      Object.getPrototypeOf(headers) !== Object.prototype)
      ? Object.freeze({ ...headers })
      : headers;
  return Object.isFrozen(data) && snapshot === headers
    ? data
    : Object.freeze({ ...data, headers: snapshot });
};

const readOwn = (record: Record<string, unknown>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const normalizeKeyPrefix = (
  options: Record<string, unknown> | undefined
): readonly JsonValue[] => {
  if (options === undefined || !Object.hasOwn(options, "keyPrefix")) {
    return [];
  }
  const { keyPrefix: prefix } = options;
  if (!Array.isArray(prefix) || prefix.length === 0) {
    throw new HydrationCodecError("InvalidKeyPrefix");
  }
  try {
    return canonicalizeArray(prefix);
  } catch (error) {
    throw new HydrationCodecError("InvalidKeyPrefix", {
      message: "keyPrefix must contain only JSON-safe values",
      cause: error,
    });
  }
};

const validateViews = (
  options: Record<string, unknown> | undefined,
  allowed: ReadonlySet<string>
): ReadonlyMap<string, boolean> => {
  const result = new Map<string, boolean>();
  if (options === undefined || !Object.hasOwn(options, "views")) {
    return result;
  }
  const { views } = options;
  if (views === undefined) {
    return result;
  }
  if (!Predicate.isObject(views)) {
    throw new HydrationCodecError("InvalidContractPath", {
      message: "views must be an object of boolean view toggles",
    });
  }
  for (const [key, value] of Object.entries(views)) {
    if (!allowed.has(key)) {
      throw new HydrationCodecError("UnknownPath", {
        message: `Unknown hydration view "${key}"`,
      });
    }
    if (value !== undefined) {
      if (!Predicate.isBoolean(value)) {
        throw new HydrationCodecError("InvalidContractPath", {
          message: `Hydration view "${key}" must be a boolean`,
        });
      }
      result.set(key, value);
    }
  }
  return result;
};

const isWithHeadersValue = (
  value: unknown
): value is HttpApiSchema.withHeaders<unknown, unknown> =>
  Predicate.hasProperty(value, HttpApiSchema.WithHeadersValueTypeId);

const isStreamSse = (
  schema: Schema.Top
): schema is HttpApiSchema.StreamSse<
  Schema.Codec<unknown, unknown, unknown, unknown> & {
    readonly Type: {
      readonly event: string;
      readonly data: unknown;
      readonly id?: string | undefined;
    };
    readonly Encoded: {
      readonly event?: string | undefined;
      readonly data: string;
      readonly id?: string | undefined;
    };
  },
  Schema.Top,
  unknown
> =>
  Predicate.hasProperty(schema, "~effect/http-api/HttpApiSchema/Stream") &&
  Predicate.hasProperty(schema, "_tag") &&
  schema._tag === "StreamSse";

const isStreamNdjson = (
  schema: Schema.Top
): schema is HttpApiSchema.StreamNdjson<Schema.Top> =>
  Predicate.hasProperty(schema, "~effect/http-api/HttpApiSchema/Stream") &&
  Predicate.hasProperty(schema, "_tag") &&
  schema._tag === "StreamNdjson";

const isRedactedAst = (ast: SchemaAST.AST): boolean => {
  const representation = ast.annotations?.["representation"];
  return (
    Predicate.hasProperty(representation, "id") &&
    representation.id === "effect/schema/Redacted"
  );
};

const isOpaqueDeclaration = (ast: SchemaAST.AST): boolean =>
  ast._tag === "Declaration" &&
  !Predicate.isFunction(ast.annotations?.["toCodecJson"]) &&
  !Predicate.isFunction(ast.annotations?.["toCodec"]);

const isUnencodableAst = (
  ast: SchemaAST.AST,
  seen: Set<SchemaAST.AST>
): boolean => {
  if (seen.has(ast)) {
    return false;
  }
  seen.add(ast);
  if (isRedactedAst(ast)) {
    return true;
  }
  if (ast.encoding !== undefined && ast.encoding.length > 0) {
    if (isOpaqueDeclaration(ast)) {
      const [firstLink] = ast.encoding;
      if (
        firstLink !== undefined &&
        (SchemaAST.isUnknown(firstLink.to) ||
          firstLink.to._tag === "Union" ||
          firstLink.to._tag === "Any")
      ) {
        return true;
      }
    }
    return ast.encoding.some((link) => isUnencodableAst(link.to, seen));
  }
  return isUnencodableBodyAst(ast, seen);
};

const unencodableTags = new Set<SchemaAST.AST["_tag"]>([
  "Declaration",
  "BigInt",
  "Symbol",
  "UniqueSymbol",
]);

const isUnencodableBodyAst = (
  ast: SchemaAST.AST,
  seen: Set<SchemaAST.AST>
): boolean => {
  if (unencodableTags.has(ast._tag)) {
    return true;
  }
  if (SchemaAST.isLiteral(ast)) {
    return (
      !Predicate.isString(ast.literal) &&
      !Predicate.isNumber(ast.literal) &&
      !Predicate.isBoolean(ast.literal)
    );
  }
  if (SchemaAST.isArrays(ast)) {
    return (
      ast.elements.some((element) => isUnencodableAst(element, seen)) ||
      ast.rest.some((rest) => isUnencodableAst(rest, seen))
    );
  }
  if (SchemaAST.isObjects(ast)) {
    return (
      ast.propertySignatures.some(
        (property) =>
          !Predicate.isString(property.name) ||
          isUnencodableAst(property.type, seen)
      ) ||
      ast.indexSignatures.some(
        (signature) =>
          isUnencodableAst(signature.parameter, seen) ||
          isUnencodableAst(signature.type, seen)
      )
    );
  }
  if (SchemaAST.isUnion(ast)) {
    return ast.types.some((member) => isUnencodableAst(member, seen));
  }
  if (SchemaAST.isSuspend(ast)) {
    return isUnencodableAst(ast.thunk(), seen);
  }
  return false;
};

const assertEncodable = (
  schema: Schema.Top,
  path: string,
  view: QueryView
): void => {
  if (isUnencodableAst(schema.ast, new Set())) {
    throw new HydrationCodecError("UnencodableSchema", {
      path,
      view,
      message: `Schema for "${path}" (${view}) is not JSON-encodable; provide a custom codec override or disable it with false`,
    });
  }
};

const acceptsTag = (
  ast: SchemaAST.AST,
  tags: ReadonlySet<SchemaAST.AST["_tag"]>,
  seen: Set<SchemaAST.AST>
): boolean => {
  if (seen.has(ast)) {
    return false;
  }
  seen.add(ast);
  if (tags.has(ast._tag)) {
    return true;
  }
  if (SchemaAST.isUnion(ast)) {
    return ast.types.some((member) => acceptsTag(member, tags, seen));
  }
  if (SchemaAST.isSuspend(ast)) {
    return acceptsTag(ast.thunk(), tags, seen);
  }
  return false;
};

const undefinedTags = new Set<SchemaAST.AST["_tag"]>(["Undefined", "Void"]);
const nullTags = new Set<SchemaAST.AST["_tag"]>(["Null"]);

const acceptsUndefined = (ast: SchemaAST.AST): boolean =>
  acceptsTag(ast, undefinedTags, new Set());

const acceptsNull = (ast: SchemaAST.AST): boolean =>
  acceptsTag(ast, nullTags, new Set());

const toJsonCodecSafe = (
  schema: Schema.Top,
  path: string,
  view: QueryView
): Schema.Top => {
  try {
    return Schema.toCodecJson(schema);
  } catch (error) {
    throw new HydrationCodecError("UnencodableSchema", {
      path,
      view,
      message: `Schema for "${path}" (${view}) cannot be converted to a JSON codec`,
      cause: error,
    });
  }
};

const deriveJsonCodec = (
  schema: Schema.Top,
  path: string,
  view: QueryView
): Schema.Top => {
  const derived = toJsonCodecSafe(schema, path, view);
  assertEncodable(derived, path, view);
  if (schema.ast.encoding !== undefined) {
    const encoded = Schema.toEncoded(schema);
    if (SchemaAST.isUnion(encoded.ast)) {
      return protectUnion(toJsonCodecSafe(encoded, path, view)).pipe(
        Schema.decodeTo(schema)
      );
    }
  }
  return derived;
};

const stripTopLevelUndefined = (
  ast: SchemaAST.AST
): SchemaAST.AST | undefined => {
  if (undefinedTags.has(ast._tag)) {
    return undefined;
  }
  if (SchemaAST.isSuspend(ast)) {
    return new SchemaAST.Suspend(
      () => stripTopLevelUndefined(ast.thunk()) ?? Schema.Never.ast,
      ast.annotations,
      ast.checks,
      ast.encoding,
      ast.context
    );
  }
  if (SchemaAST.isUnion(ast)) {
    const remaining: SchemaAST.AST[] = [];
    for (const member of ast.types) {
      const stripped = stripTopLevelUndefined(member);
      if (stripped !== undefined) {
        remaining.push(stripped);
      }
    }
    if (remaining.length === 0) {
      return undefined;
    }
    return new SchemaAST.Union(
      remaining,
      ast.options,
      ast.annotations,
      ast.checks,
      ast.encoding,
      ast.context,
      ast.encodingChecks
    );
  }
  return ast;
};

const toTop = (schema: Schema.Constraint): Schema.Top =>
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  schema as Schema.Top;

const tagCodec = (tag: number | string, codec: Schema.Top): Schema.Top =>
  Schema.Tuple([Schema.Literal(tag), codec]).pipe(
    Schema.decodeTo(
      Schema.Unknown,
      SchemaTransformation.transform({
        decode: ([, value]) => value,
        encode: (value) => [tag, value] as const,
      })
    )
  );

const preferExactMembers = <DecodingServices, EncodingServices>(
  union: Schema.Codec<unknown, unknown, DecodingServices, EncodingServices>
): Schema.Top => {
  const encode = SchemaParser.encodeUnknownEffect(union, {});
  const decode = SchemaParser.decodeUnknownEffect(union, {});
  return Schema.Unknown.pipe(
    Schema.decodeTo(
      Schema.Unknown,
      SchemaTransformation.transformEffect({
        decode,
        encode: (value, options) =>
          options.onExcessProperty === "error"
            ? encode(value, options)
            : encode(value, { ...options, onExcessProperty: "error" }).pipe(
                Effect.catch(() => encode(value, options))
              ),
      })
    )
  );
};

const protectUnion = (codec: Schema.Top): Schema.Top => {
  const preserveUnionMembers = Function.memoize(
    (ast: SchemaAST.AST): SchemaAST.AST => {
      if (ast.encoding !== undefined) {
        return ast;
      }
      if (SchemaAST.isSuspend(ast)) {
        return new SchemaAST.Suspend(
          () => preserveUnionMembers(ast.thunk()),
          ast.annotations,
          ast.checks,
          ast.encoding,
          ast.context
        );
      }
      if (!SchemaAST.isUnion(ast) || ast.types.length < 2) {
        return ast;
      }
      const members = ast.types.map(
        (member, index) =>
          tagCodec(index, Schema.make<Schema.Top>(preserveUnionMembers(member)))
            .ast
      );
      const union = Schema.make<Schema.Top>(
        new SchemaAST.Union(
          members,
          ast.options,
          ast.annotations,
          ast.checks,
          undefined,
          undefined,
          ast.encodingChecks
        )
      );
      return preferExactMembers(union).ast;
    }
  );
  return Schema.make<Schema.Top>(preserveUnionMembers(codec.ast));
};

const adaptStreamedElement = (codec: Schema.Top): Schema.Top => {
  if (!acceptsUndefined(codec.ast)) {
    return protectUnion(codec);
  }
  const withoutUndefined = stripTopLevelUndefined(codec.ast);
  if (withoutUndefined === undefined) {
    return UndefinedElementCodec;
  }
  const nonUndefinedCodec = protectUnion(
    Schema.make<Schema.Top>(withoutUndefined)
  );
  return Schema.Union([
    UndefinedElementCodec,
    tagCodec("value", nonUndefinedCodec),
  ]);
};

const adaptQueryData = (codec: Schema.Top): Schema.Top => {
  if (!acceptsUndefined(codec.ast)) {
    return protectUnion(codec);
  }
  const withoutUndefined = stripTopLevelUndefined(codec.ast);
  if (withoutUndefined === undefined) {
    return Schema.Null;
  }
  const nonUndefined = protectUnion(Schema.make<Schema.Top>(withoutUndefined));
  return acceptsNull(codec.ast)
    ? nonUndefined
    : Schema.Union([
        tagCodec("null", Schema.Null),
        tagCodec("value", nonUndefined),
      ]);
};

const makeMetadataCodec = (
  dataCodec: Schema.Top,
  status: Schema.Top = Schema.Finite
): Schema.Top =>
  Schema.Struct({
    status,
    data: dataCodec,
    headers: Schema.Record(Schema.String, Schema.String),
  });

const makeInfiniteCodec = (
  pageCodec: Schema.Top,
  pageParamCodec: Schema.Top
): Schema.Top =>
  Schema.Struct({
    pages: Schema.Array(pageCodec),
    pageParams: Schema.Array(pageParamCodec),
  });

const asCodec = (
  schema: Schema.Top
): Schema.Codec<unknown, unknown, unknown, unknown> => schema;

const deriveBufferedMemberCodec = (
  schema: Schema.Top,
  path: string,
  view: QueryView
): Schema.Top => {
  if (HttpApiSchema.isWithHeaders(schema)) {
    const bodyCodec = deriveBufferedMemberCodec(schema.schema, path, view);
    const headersCodec = deriveJsonCodec(schema.headers, path, view);
    const adaptedBody =
      acceptsUndefined(bodyCodec.ast) && acceptsNull(bodyCodec.ast)
        ? adaptStreamedElement(bodyCodec)
        : protectUnion(bodyCodec);
    return Schema.Struct({
      body: adaptedBody,
      headers: protectUnion(headersCodec),
    }).pipe(
      Schema.decodeTo(
        Schema.toType(schema),
        SchemaTransformation.transform({
          decode: ({ body, headers }) =>
            HttpApiSchema.withHeaders({ body, headers }),
          encode: (value) => {
            if (!isWithHeadersValue(value)) {
              throw new TypeError("Expected a WithHeaders response value");
            }
            return { body: value.body, headers: value.headers };
          },
        })
      )
    );
  }
  if (HttpApiSchema.getEncodeToWithHeadersParts(schema) !== undefined) {
    return deriveJsonCodec(Schema.toType(schema), path, view);
  }
  return deriveJsonCodec(schema, path, view);
};

const deriveHttpBufferedCodec = (
  successes: readonly Schema.Top[],
  path: string,
  view: QueryView
): Schema.Top => {
  const effective =
    successes.length > 0 ? successes : [HttpApiSchema.NoContent];
  const memberCodecs = effective.map((schema) =>
    adaptQueryData(deriveBufferedMemberCodec(schema, path, view))
  );
  const [first] = memberCodecs;
  return memberCodecs.length === 1 && first !== undefined
    ? first
    : preferExactMembers(
        Schema.Union(memberCodecs.map((codec, index) => tagCodec(index, codec)))
      );
};

const deriveHttpMetadataCodec = (
  successes: ReadonlyMap<number, readonly Schema.Top[]>,
  path: string
): Schema.Top => {
  if (successes.size === 1) {
    const [members] = successes.values();
    return makeMetadataCodec(
      deriveHttpBufferedCodec(members ?? [], path, "metadata")
    );
  }
  return Schema.Union(
    [...successes].map(([status, members]) =>
      makeMetadataCodec(
        deriveHttpBufferedCodec(members, path, "metadata"),
        Schema.Literal(status)
      )
    )
  );
};

const extractHttpStreamChunkSchema = (
  streamSchema: Schema.Top,
  path: string,
  view: QueryView
): Schema.Top => {
  if (isStreamSse(streamSchema)) {
    if (
      streamSchema.sseMode === "data" &&
      Predicate.hasProperty(streamSchema.events, "fields") &&
      Predicate.isObject(streamSchema.events.fields) &&
      Predicate.hasProperty(streamSchema.events.fields["data"], "to") &&
      Schema.isSchema(streamSchema.events.fields["data"].to)
    ) {
      const dataCodec = streamSchema.events.fields["data"].to;
      assertEncodable(dataCodec, path, view);
      return dataCodec;
    }
    return deriveJsonCodec(toTop(streamSchema.events), path, view);
  }
  if (isStreamNdjson(streamSchema)) {
    return deriveJsonCodec(streamSchema.schema, path, view);
  }
  throw new HydrationCodecError("UnencodableSchema", {
    path,
    view,
    message: `Unsupported HTTP stream schema for "${path}"`,
  });
};

const deriveHttpStreamCodec = (
  successSchema: Schema.Top,
  path: string,
  view: "live" | "streamed"
): Schema.Top => {
  if (HttpApiSchema.isWithHeaders(successSchema)) {
    const chunkCodec = extractHttpStreamChunkSchema(
      successSchema.schema,
      path,
      view
    );
    const headersCodec = deriveJsonCodec(successSchema.headers, path, view);
    const adaptedChunk =
      acceptsUndefined(chunkCodec.ast) && acceptsNull(chunkCodec.ast)
        ? adaptStreamedElement(chunkCodec)
        : protectUnion(chunkCodec);
    const wrapped = Schema.Struct({
      body: adaptedChunk,
      headers: protectUnion(headersCodec),
    }).pipe(
      Schema.decodeTo(
        Schema.toType(
          HttpApiSchema.WithHeaders(
            Schema.toType(chunkCodec),
            Schema.toType(headersCodec)
          )
        ),
        SchemaTransformation.transform({
          decode: ({ body, headers }) =>
            HttpApiSchema.withHeaders({ body, headers }),
          encode: (value) => {
            if (!isWithHeadersValue(value)) {
              throw new TypeError("Expected a WithHeaders stream chunk");
            }
            return { body: value.body, headers: value.headers };
          },
        })
      )
    );
    return view === "live" ? wrapped : Schema.Array(wrapped);
  }

  const chunkCodec = extractHttpStreamChunkSchema(successSchema, path, view);
  if (view === "live") {
    return adaptQueryData(chunkCodec);
  }
  return Schema.Array(adaptStreamedElement(chunkCodec));
};

const validateSegments = (
  operations: readonly {
    readonly path: string;
    readonly segments: readonly string[];
  }[]
): void => {
  const branchPaths = new Map<string, readonly string[]>();
  const leafPaths = new Set<string>();
  for (const { path, segments } of operations) {
    if (
      !EffectArray.isReadonlyArrayNonEmpty(segments) ||
      segments.some(isInvalidUtilitySegment)
    ) {
      throw new HydrationCodecError("InvalidContractPath", {
        path,
        message: `Contract path "${path}" cannot be projected into a hydration key`,
      });
    }
    const pathKey = JSON.stringify(segments);
    if (leafPaths.has(pathKey)) {
      throw new HydrationCodecError("InvalidContractPath", {
        path,
        message: `Contract path "${path}" duplicates another operation`,
      });
    }
    if (branchPaths.has(pathKey)) {
      throw new HydrationCodecError("InvalidContractPath", {
        path,
        message: `Contract path "${path}" collides with a nested operation`,
      });
    }
    for (let index = 1; index < segments.length; index += 1) {
      const parentKey = JSON.stringify(segments.slice(0, index));
      if (leafPaths.has(parentKey)) {
        throw new HydrationCodecError("InvalidContractPath", {
          path,
          message: `Contract path "${path}" collides with a parent operation`,
        });
      }
      if (!branchPaths.has(parentKey)) {
        branchPaths.set(parentKey, segments);
      }
    }
    leafPaths.add(pathKey);
  }
};

const readPathsOption = (
  options: Record<string, unknown> | undefined
): Record<string, unknown> => {
  if (options === undefined || !Object.hasOwn(options, "paths")) {
    return {};
  }
  const { paths } = options;
  if (paths === undefined) {
    return {};
  }
  if (!Predicate.isObject(paths)) {
    throw new HydrationCodecError("InvalidContractPath", {
      message: "paths must be an object keyed by contract dot-paths",
    });
  }
  return paths;
};

const validatePathConfigKeys = (
  path: string,
  config: Record<string, unknown>,
  allowed: ReadonlySet<string>
): void => {
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && !allowed.has(key)) {
      throw new HydrationCodecError("UnknownPath", {
        path,
        message: `Unsupported hydration view "${key}" for "${path}"`,
      });
    }
  }
};

const extractInfiniteConfig = (
  path: string,
  infinite: unknown
):
  | { readonly pageParam: Schema.Top; readonly page?: Schema.Top }
  | undefined => {
  if (infinite === undefined || infinite === false) {
    return undefined;
  }
  const config = Predicate.isObject(infinite) ? infinite : {};
  const pageParam = readOwn(config, "pageParam");
  if (!Schema.isSchema(pageParam)) {
    throw new HydrationCodecError("InvalidContractPath", {
      path,
      view: "infinite",
      message: `Infinite hydration config for "${path}" requires a pageParam schema`,
    });
  }
  const page = readOwn(config, "page");
  if (page !== undefined && !Schema.isSchema(page)) {
    throw new HydrationCodecError("InvalidContractPath", {
      path,
      view: "infinite",
      message: `Infinite hydration page override for "${path}" must be a Schema`,
    });
  }
  return page === undefined ? { pageParam } : { pageParam, page };
};

const resolvePathConfigObject = (
  path: string,
  pathConfig: unknown
): Record<string, unknown> | false => {
  if (pathConfig === false) {
    return false;
  }
  if (pathConfig !== undefined && !Predicate.isObject(pathConfig)) {
    throw new HydrationCodecError("InvalidContractPath", {
      path,
      message: `Hydration config for "${path}" must be false or a view map`,
    });
  }
  return pathConfig ?? {};
};

const rpcUnaryKeys = new Set(["query", "infinite"]);
const rpcStreamKeys = new Set(["live", "streamed"]);
const httpBufferedKeys = new Set(["query", "metadata", "infinite"]);
const httpStreamKeys = new Set(["live", "streamed"]);

const registerStreamViews = (
  codecs: CompiledHydrationCodec[],
  operationPrefix: readonly JsonValue[],
  config: Record<string, unknown>,
  views: ReadonlyMap<string, boolean>,
  deriveLive: () => Schema.Top,
  deriveStreamed: () => Schema.Top
): void => {
  const liveConfig = readOwn(config, "live");
  const streamedConfig = readOwn(config, "streamed");
  if (liveConfig !== false) {
    if (Schema.isSchema(liveConfig)) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "live"]),
          asCodec(liveConfig)
        )
      );
    } else if (views.get("live") !== false) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "live"]),
          asCodec(deriveLive())
        )
      );
    }
  }
  if (streamedConfig !== false) {
    if (Schema.isSchema(streamedConfig)) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "streamed"]),
          asCodec(streamedConfig)
        )
      );
    } else if (views.get("streamed") !== false) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "streamed"]),
          asCodec(deriveStreamed())
        )
      );
    }
  }
};

const collectRpcOperationCodecs = (
  codecs: CompiledHydrationCodec[],
  operationPrefix: readonly JsonValue[],
  path: string,
  rpc: Rpc.AnyWithProps,
  config: Record<string, unknown>,
  views: ReadonlyMap<string, boolean>
): void => {
  if (RpcSchema.isStreamSchema(rpc.successSchema)) {
    validatePathConfigKeys(path, config, rpcStreamKeys);
    const chunkSchema = rpc.successSchema.success;
    const deriveChunk = (view: "live" | "streamed") =>
      deriveJsonCodec(chunkSchema, path, view);
    registerStreamViews(
      codecs,
      operationPrefix,
      config,
      views,
      () => adaptQueryData(deriveChunk("live")),
      () => Schema.Array(adaptStreamedElement(deriveChunk("streamed")))
    );
    return;
  }

  validatePathConfigKeys(path, config, rpcUnaryKeys);
  const deriveUnary = (view: "query" | "infinite") =>
    adaptQueryData(deriveJsonCodec(rpc.successSchema, path, view));

  const queryConfig = readOwn(config, "query");
  const infiniteConfig = readOwn(config, "infinite");
  const customQuery = Schema.isSchema(queryConfig) ? queryConfig : undefined;
  if (queryConfig !== false) {
    if (customQuery !== undefined) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "query"]),
          asCodec(customQuery)
        )
      );
    } else if (views.get("query") !== false) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "query"]),
          asCodec(deriveUnary("query"))
        )
      );
    }
  }

  const infinite = extractInfiniteConfig(path, infiniteConfig);
  if (infinite !== undefined) {
    const pageCodec = infinite.page ?? customQuery ?? deriveUnary("infinite");
    codecs.push(
      compileHydrationCodec(
        Object.freeze([...operationPrefix, "infinite"]),
        asCodec(makeInfiniteCodec(pageCodec, infinite.pageParam))
      )
    );
  }
};

const buildRpcContractRegistry = (
  group: RpcGroup.Any,
  options: Record<string, unknown> | undefined
): HydrationRegistry<unknown, unknown> => {
  const keyPrefix = normalizeKeyPrefix(options);
  const views = validateViews(options, rpcAllowedViews);
  const paths = readPathsOption(options);

  const operations: {
    readonly path: string;
    readonly segments: readonly string[];
    readonly rpc: Rpc.AnyWithProps;
  }[] = [];

  if (
    !Predicate.hasProperty(group, "requests") ||
    !Predicate.isMap(group.requests)
  ) {
    throw new TypeError("Expected an Effect RPC group with a request map");
  }

  for (const value of group.requests.values()) {
    if (!Rpc.isRpc(value)) {
      throw new TypeError("Expected an Effect RPC declaration");
    }
    const rawTag: unknown = value._tag;
    if (!Predicate.isString(rawTag)) {
      throw new TypeError("Expected an Effect RPC declaration");
    }
    operations.push({
      path: rawTag,
      segments: rawTag.split("."),
      rpc: value,
    });
  }

  validateSegments(operations);

  const knownPaths = new Set(operations.map((op) => op.path));
  for (const path of Object.keys(paths)) {
    if (!knownPaths.has(path)) {
      throw new HydrationCodecError("UnknownPath", { path });
    }
  }

  const codecs: CompiledHydrationCodec[] = [];
  const rootPrefix = [...keyPrefix, "rpc"];

  for (const { path, segments, rpc } of operations) {
    const config = resolvePathConfigObject(path, readOwn(paths, path));
    if (config === false) {
      continue;
    }
    collectRpcOperationCodecs(
      codecs,
      [...rootPrefix, ...segments],
      path,
      rpc,
      config,
      views
    );
  }

  return buildHydrationRegistry(codecs);
};

const collectHttpOperationCodecs = (
  codecs: CompiledHydrationCodec[],
  operationPrefix: readonly JsonValue[],
  path: string,
  classified: QueryableHttpEndpoint,
  successesByStatus: ReadonlyMap<number, readonly Schema.Top[]>,
  config: Record<string, unknown>,
  views: ReadonlyMap<string, boolean>
): void => {
  if (classified.kind === "Streaming") {
    validatePathConfigKeys(path, config, httpStreamKeys);
    registerStreamViews(
      codecs,
      operationPrefix,
      config,
      views,
      () => deriveHttpStreamCodec(classified.success, path, "live"),
      () => deriveHttpStreamCodec(classified.success, path, "streamed")
    );
    return;
  }

  validatePathConfigKeys(path, config, httpBufferedKeys);
  const deriveBuffered = (view: "query" | "infinite") =>
    deriveHttpBufferedCodec(classified.successes, path, view);

  const queryConfig = readOwn(config, "query");
  const metadataConfig = readOwn(config, "metadata");
  const infiniteConfig = readOwn(config, "infinite");
  const customQuery = Schema.isSchema(queryConfig) ? queryConfig : undefined;
  if (queryConfig !== false) {
    if (customQuery !== undefined) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "query"]),
          asCodec(customQuery)
        )
      );
    } else if (views.get("query") !== false) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "query"]),
          asCodec(deriveBuffered("query"))
        )
      );
    }
  }

  if (metadataConfig !== false) {
    if (Schema.isSchema(metadataConfig)) {
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "metadata"]),
          asCodec(metadataConfig),
          { postDecode: freezeMetadata }
        )
      );
    } else if (views.get("metadata") !== false) {
      const metadataCodec =
        customQuery === undefined
          ? deriveHttpMetadataCodec(successesByStatus, path)
          : makeMetadataCodec(customQuery);
      codecs.push(
        compileHydrationCodec(
          Object.freeze([...operationPrefix, "metadata"]),
          asCodec(metadataCodec),
          { postDecode: freezeMetadata }
        )
      );
    }
  }

  const infinite = extractInfiniteConfig(path, infiniteConfig);
  if (infinite !== undefined) {
    const pageCodec =
      infinite.page ?? customQuery ?? deriveBuffered("infinite");
    codecs.push(
      compileHydrationCodec(
        Object.freeze([...operationPrefix, "infinite"]),
        asCodec(makeInfiniteCodec(pageCodec, infinite.pageParam))
      )
    );
  }
};

const validateHttpPaths = (
  operations: readonly { readonly path: string }[],
  paths: Record<string, unknown>
): void => {
  const pathCounts = new Map<string, number>();
  for (const { path } of operations) {
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  }
  const ambiguousPaths = new Set<string>();
  for (const [path, count] of pathCounts) {
    if (count > 1) {
      ambiguousPaths.add(path);
    }
  }
  for (const path of Object.keys(paths)) {
    if (ambiguousPaths.has(path)) {
      throw new HydrationCodecError("InvalidContractPath", {
        path,
        message: `HTTP hydration path "${path}" is ambiguous across dotted group and endpoint identifiers`,
      });
    }
    if (!pathCounts.has(path)) {
      throw new HydrationCodecError("UnknownPath", { path });
    }
  }
};

const buildHttpContractRegistry = (
  api: HttpApi.Top,
  options: Record<string, unknown> | undefined
): HydrationRegistry<unknown, unknown> => {
  const keyPrefix = normalizeKeyPrefix(options);
  const views = validateViews(options, httpAllowedViews);
  const paths = readPathsOption(options);

  const operations: {
    readonly path: string;
    readonly segments: readonly string[];
    readonly classified: QueryableHttpEndpoint;
    readonly successesByStatus: ReadonlyMap<number, readonly Schema.Top[]>;
  }[] = [];

  HttpApi.reflect(api, {
    onGroup: Function.constVoid,
    onEndpoint: ({ group, endpoint, successes }) => {
      const classified = classifyHttpEndpoint(endpoint);
      if (
        classified === undefined ||
        classified.kind === "Mutation" ||
        classified.kind === "ContradictoryMultipart"
      ) {
        return;
      }
      const segments = group.topLevel
        ? [endpoint.identifier]
        : [group.identifier, endpoint.identifier];
      const path = group.topLevel
        ? endpoint.identifier
        : `${group.identifier}.${endpoint.identifier}`;
      operations.push({
        path,
        segments,
        classified,
        successesByStatus: successes,
      });
    },
  });

  validateSegments(operations);
  validateHttpPaths(operations, paths);

  const codecs: CompiledHydrationCodec[] = [];
  const rootPrefix = [...keyPrefix, "http", api.identifier];

  for (const { path, segments, classified, successesByStatus } of operations) {
    const config = resolvePathConfigObject(path, readOwn(paths, path));
    if (config === false) {
      continue;
    }
    collectHttpOperationCodecs(
      codecs,
      [...rootPrefix, ...segments],
      path,
      classified,
      successesByStatus,
      config,
      views
    );
  }

  return buildHydrationRegistry(codecs);
};

const isRpcGroup = (
  value: RpcGroup.Any | HttpApi.Constraint
): value is RpcGroup.Any =>
  Predicate.hasProperty(value, "requests") && Predicate.isMap(value.requests);

const isHttpApi = (
  value: RpcGroup.Any | HttpApi.Constraint
): value is HttpApi.Top =>
  Predicate.hasProperty(value, "groups") &&
  Predicate.isObject(value.groups) &&
  Predicate.hasProperty(value, "identifier") &&
  Predicate.isString(value.identifier);

/** Derives a hydration codec registry directly from an Effect `RpcGroup` contract. */
export function createContractHydrationRegistry<
  Group extends RpcGroup.Any,
  const Options extends object | undefined = undefined,
>(
  contract: Group,
  options?: Options &
    NoInfer<
      Options extends undefined
        ? undefined
        : RpcContractHydrationOptions<Group, Options>
    >
): HydrationRegistry<
  RpcContractDecodingServices<Group, Options>,
  RpcContractEncodingServices<Group, Options>
>;

/** Derives a hydration codec registry directly from an Effect `HttpApi` contract. */
export function createContractHydrationRegistry<
  Api extends HttpApi.Constraint,
  const Options extends object | undefined = undefined,
>(
  contract: Api,
  options?: Options &
    NoInfer<
      Options extends undefined
        ? undefined
        : HttpContractHydrationOptions<Api, Options>
    >
): HydrationRegistry<
  HttpContractDecodingServices<Api, Options>,
  HttpContractEncodingServices<Api, Options>
>;

export function createContractHydrationRegistry(
  contract: RpcGroup.Any | HttpApi.Constraint,
  options?: Record<string, unknown>
): HydrationRegistry<unknown, unknown> {
  if (options !== undefined && !Predicate.isObject(options)) {
    throw new HydrationCodecError("InvalidContractPath", {
      message: "Contract hydration options must be an object",
    });
  }
  if (isRpcGroup(contract)) {
    return buildRpcContractRegistry(contract, options);
  }
  if (isHttpApi(contract)) {
    return buildHttpContractRegistry(contract, options);
  }
  throw new TypeError("Expected an Effect RpcGroup or HttpApi contract");
}
