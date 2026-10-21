import { Effect, Predicate } from "effect";
import type { Cause } from "effect";
import type { Sse } from "effect/encoding";
import type { HttpClientResponse } from "effect/http";
import type { HttpApi } from "effect/http-api";

import type {
  MutationOperation,
  StreamingOperation,
  RuntimeKeyEncoder,
  TreeErrors,
  UnaryOperation,
} from "../core/operation";
import {
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryError,
} from "./errors";
import type { HttpApiEndpointIdentity } from "./errors";
import { createHttpRequest } from "./request";
import type { HttpRequestDescription } from "./request";
import { createHttpStreamPreparation } from "./streamed-query";

type HttpOperation = (
  | UnaryOperation
  | MutationOperation
  | StreamingOperation
) & {
  readonly identity: HttpApiEndpointIdentity;
};

type RuntimeHttpMethod = <Mode extends "decoded-only" | "decoded-and-response">(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  request: Record<string, unknown> & { readonly responseMode: Mode }
) => Effect.Effect<
  Mode extends "decoded-and-response"
    ? readonly [unknown, HttpClientResponse.HttpClientResponse]
    : unknown,
  unknown,
  unknown
>;

export interface CompiledHttpOperations {
  readonly operations: readonly (
    | UnaryOperation
    | MutationOperation
    | StreamingOperation
  )[];
  readonly errors: TreeErrors;
  readonly keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters
const freezeMetadata = (data: unknown) => {
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

interface HttpEndpointDescription {
  readonly identity: HttpApiEndpointIdentity;
  readonly topLevel: boolean;
  readonly request: HttpRequestDescription;
}

const httpContracts = new WeakMap<
  HttpApi.Top,
  readonly HttpEndpointDescription[]
>();

const describeHttpEndpoints = (
  api: HttpApi.Top
): readonly HttpEndpointDescription[] => {
  const cached = httpContracts.get(api);
  if (cached !== undefined) {
    return cached;
  }
  const descriptions: HttpEndpointDescription[] = [];
  for (const group of Object.values(api.groups)) {
    for (const endpoint of Object.values(group.endpoints)) {
      const identity = {
        apiId: api.identifier,
        groupId: group.identifier,
        endpoint: endpoint.identifier,
        method: endpoint.method,
      };
      const request = createHttpRequest(endpoint, identity);
      if (request === undefined) {
        continue;
      }
      descriptions.push({ identity, topLevel: group.topLevel, request });
    }
  }
  if (
    descriptions.every(
      ({ request }) =>
        request.kind === "Mutation" ||
        request.input._tag === "Inputless" ||
        request.input.cacheable
    )
  ) {
    httpContracts.set(api, descriptions);
  }
  return descriptions;
};

const extractHttpEndpoints = (
  api: HttpApi.Top,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  client: unknown
): readonly HttpOperation[] => {
  const operations: HttpOperation[] = [];
  for (const { identity, topLevel, request } of describeHttpEndpoints(api)) {
    let target = client;
    if (!topLevel) {
      target = Predicate.hasProperty(client, identity.groupId)
        ? client[identity.groupId]
        : undefined;
    }
    const invoke = <Mode extends "decoded-only" | "decoded-and-response">(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters
      requestInput: unknown,
      responseMode: Mode,
      sseOptions?: Sse.DecodeOptions
    ) => {
      const method = Predicate.hasProperty(target, identity.endpoint)
        ? target[identity.endpoint]
        : undefined;
      if (method === undefined) {
        throw new TypeError(
          `Missing HTTP client endpoint ${identity.endpoint}`
        );
      }
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
      const call = method as RuntimeHttpMethod;
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
      return call.bind(target)({
        ...(Predicate.isObject(requestInput) ? requestInput : undefined),
        responseMode,
        ...(sseOptions === undefined ? undefined : { sseOptions }),
      });
    };
    const common = {
      identity,
      id: JSON.stringify([identity.groupId, identity.endpoint]),
      path: topLevel
        ? [identity.endpoint]
        : [identity.groupId, identity.endpoint],
      unsupportedQueryHash: (option: "queryKeyHashFn" | "queryHash") =>
        new EffectHttpApiQueryConfigError(
          "UnsupportedQueryHash",
          `${option} must be configured through QueryClient defaults`,
          identity
        ),
      takeOptions: () => null,
    };
    if (request.kind === "Streaming") {
      operations.push({
        ...common,
        ...request,
        kind: "Streaming",
        prepareStream: createHttpStreamPreparation(
          identity,
          (requestInput, sseOptions) =>
            // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
            invoke(requestInput, "decoded-only", sseOptions)
        ),
      });
    } else {
      operations.push({
        ...common,
        ...request,
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
        invoke: (requestInput) => invoke(requestInput, "decoded-only"),
        ...(request.kind === "Unary"
          ? {
              metadata: {
                // oxlint-disable-next-line anti-slop/no-unknown-parameters
                invoke: (requestInput: unknown) =>
                  Effect.map(
                    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
                    invoke(requestInput, "decoded-and-response"),
                    ([data, response]) =>
                      freezeMetadata({
                        data: data === undefined ? null : data,
                        status: response.status,
                        headers: response.headers,
                      })
                  ),
                executionError: (
                  operation: "metadata",
                  cause: Cause.Cause<unknown>
                ) => new EffectHttpApiQueryError(identity, operation, cause),
                finalizeData: freezeMetadata,
              },
            }
          : undefined),
        executionError: (operation, cause) =>
          new EffectHttpApiQueryError(identity, operation, cause),
      });
    }
  }
  return operations;
};

const httpTreeErrors = (
  api: HttpApi.Top,
  operations: readonly HttpOperation[]
): TreeErrors => {
  const identities = new Map(
    operations.map((operation) => [operation.id, operation.identity])
  );
  const identity = (id: string) =>
    identities.get(id) ?? { apiId: api.identifier };
  return {
    invalidPrefix: (reason, cause) =>
      new EffectHttpApiQueryConfigError(
        "InvalidKeyPrefix",
        reason === "Shape"
          ? "keyPrefix must be a non-empty readonly tuple of JSON-safe values"
          : "keyPrefix must contain only JSON-safe values",
        { apiId: api.identifier, cause }
      ),
    invalidPath: (id) =>
      new EffectHttpApiQueryConfigError(
        "InvalidEndpointPath",
        `HTTP endpoint ${id} cannot be projected into a utility path`,
        identity(id)
      ),
    pathCollision: (id, path, relation) =>
      new EffectHttpApiQueryConfigError(
        "EndpointPathCollision",
        `HTTP endpoint ${id} ${relation} utility path ${JSON.stringify(path)}`,
        { ...identity(id), path }
      ),
    unknownEncoder: (id) =>
      new EffectHttpApiQueryConfigError(
        "UnknownKeyEncoder",
        `No query-enabled HTTP endpoint exists for key encoder ${id}`,
        identity(id)
      ),
    missingEncoder: (id) =>
      new EffectHttpApiQueryConfigError(
        "MissingKeyEncoder",
        `HTTP endpoint ${id} requires a safe custom key encoder`,
        identity(id)
      ),
  };
};

export const compileHttpOperations = (
  api: HttpApi.Top,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  client: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  suppliedEncoders: unknown
): CompiledHttpOperations => {
  const operations = extractHttpEndpoints(api, client);
  const errors = httpTreeErrors(api, operations);
  const encoderGroups = new Set(
    operations
      .filter(
        (operation) =>
          operation.kind !== "Mutation" && operation.input._tag === "Input"
      )
      .map((operation) => operation.identity.groupId)
  );
  const keyEncoders = new Map<string, RuntimeKeyEncoder>();
  for (const [groupId, endpoints] of Object.entries(
    Predicate.isObject(suppliedEncoders) ? suppliedEncoders : {}
  )) {
    if (!encoderGroups.has(groupId)) {
      throw errors.unknownEncoder(JSON.stringify([groupId]));
    }
    if (!Predicate.isObject(endpoints)) {
      throw new TypeError("HTTP key encoders must be grouped by endpoint");
    }
    for (const [endpoint, encoder] of Object.entries(endpoints)) {
      keyEncoders.set(
        JSON.stringify([groupId, endpoint]),
        // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
        encoder as RuntimeKeyEncoder
      );
    }
  }
  return { operations, errors, keyEncoders };
};
