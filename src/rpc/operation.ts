import { Predicate, SchemaAST } from "effect";
import type { Effect, Stream } from "effect";
import type { RpcClient, RpcGroup } from "effect/rpc";
import { Rpc, RpcSchema } from "effect/rpc";

import type {
  OperationDescription,
  OperationInput,
  TreeErrors,
} from "../core/operation";
import { createSchemaKeyEncoding } from "../core/schema-key";
import {
  EffectRpcQueryConfigError,
  EffectRpcQueryError,
  EffectRpcQueryKeyError,
} from "./errors";
import { createStreamPreparation } from "./streamed-query";

type RpcRequest = Pick<
  Rpc.AnyWithProps,
  "_tag" | "payloadSchema" | "successSchema"
>;

type RpcClientInvocation<Result> = (
  tag: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  input: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  options: unknown
) => Result;

const rpcInputs = new WeakMap<RpcRequest, OperationInput>();

const compileRpcInput = (definition: RpcRequest): OperationInput => {
  const { payloadSchema, _tag: rpcTag } = definition;
  if (SchemaAST.isVoid(payloadSchema.ast)) {
    return { _tag: "Inputless" };
  }
  const keyEncoding = createSchemaKeyEncoding(payloadSchema);

  return {
    _tag: "Input",
    requiresEncoder: keyEncoding.requiresEncoder,
    cacheable: keyEncoding.cacheable,
    pageInput: (input) => payloadSchema.make(input),
    invalidKey: (cause) =>
      new EffectRpcQueryKeyError(
        "InvalidKeyValue",
        rpcTag,
        `The key payload for RPC ${rpcTag} is not JSON-safe`,
        cause
      ),
    prepare: (input, encoder) => {
      let normalized: unknown;
      try {
        normalized = payloadSchema.make(input);
      } catch (error) {
        throw new EffectRpcQueryKeyError(
          "PayloadConstructionFailed",
          rpcTag,
          `Could not construct the payload for RPC ${rpcTag}`,
          error
        );
      }
      let keyValue: unknown;
      try {
        keyValue = encoder
          ? encoder(normalized)
          : keyEncoding.encode(normalized);
      } catch (error) {
        throw new EffectRpcQueryKeyError(
          encoder ? "KeyEncoderFailed" : "PayloadEncodingFailed",
          rpcTag,
          `Could not encode the key payload for RPC ${rpcTag}`,
          error
        );
      }
      return { input: normalized, keyValue };
    },
  };
};

const createRpcInput = (definition: RpcRequest): OperationInput => {
  let input = rpcInputs.get(definition);
  if (input === undefined) {
    input = compileRpcInput(definition);
    if (input._tag === "Inputless" || input.cacheable) {
      rpcInputs.set(definition, input);
    }
  }
  return input;
};

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
const takeRpcOptions = (options: Record<string, unknown>) => {
  const { rpcOptions } = options;
  delete options["rpcOptions"];
  return rpcOptions;
};

const describeRpc = (
  definition: RpcRequest,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  client: unknown
): OperationDescription => {
  const rpcTag = definition._tag;
  const identity = {
    id: rpcTag,
    path: rpcTag.split("."),
    input: createRpcInput(definition),
    unsupportedQueryHash: (option: "queryKeyHashFn" | "queryHash") =>
      new EffectRpcQueryConfigError(
        "UnsupportedQueryHash",
        `${option} must be configured through QueryClient defaults`,
        { rpcTag }
      ),
    takeOptions: takeRpcOptions,
  };
  if (!RpcSchema.isStreamSchema(definition.successSchema)) {
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
    const invoke = client as RpcClientInvocation<
      Effect.Effect<unknown, unknown, unknown>
    >;
    return {
      ...identity,
      kind: "Unary",
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
      invoke: (input, options) => invoke(rpcTag, input, options),
      executionError: (operation, cause) =>
        new EffectRpcQueryError(rpcTag, operation, cause),
    };
  }
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const invoke = client as RpcClientInvocation<
    Stream.Stream<unknown, unknown, unknown>
  >;
  return {
    ...identity,
    kind: "Streaming",
    prepareStream: createStreamPreparation({
      tag: rpcTag,
      invoke: (input, options) => invoke(rpcTag, input, options),
    }),
  };
};

export const extractRpcs = <Rpcs extends Rpc.Any, ClientError>(
  group: RpcGroup.Any,
  client: RpcClient.RpcClient.Flat<Rpcs, ClientError>
): readonly OperationDescription[] => {
  if (
    !Predicate.hasProperty(group, "requests") ||
    !Predicate.isMap(group.requests)
  ) {
    throw new TypeError("Expected an Effect RPC group with a request map");
  }
  return Array.from(group.requests.values(), (value) => {
    if (!Rpc.isRpc(value)) {
      throw new TypeError("Expected an Effect RPC declaration");
    }
    return describeRpc(value, client);
  });
};

export const rpcTreeErrors: TreeErrors = {
  invalidPrefix: (reason, cause) =>
    new EffectRpcQueryConfigError(
      "InvalidKeyPrefix",
      reason === "Shape"
        ? "keyPrefix must be a non-empty readonly tuple of JSON-safe values"
        : "keyPrefix must contain only JSON-safe values",
      { cause }
    ),
  invalidPath: (rpcTag) =>
    new EffectRpcQueryConfigError(
      "InvalidRpcPath",
      `RPC tag ${rpcTag} cannot be projected into a utility path`,
      { rpcTag }
    ),
  pathCollision: (rpcTag, segments, relation) => {
    const path = segments.join(".");
    return new EffectRpcQueryConfigError(
      "RpcPathCollision",
      `RPC tag ${rpcTag} ${relation} utility path ${path}`,
      { path, rpcTag }
    );
  },
  unknownEncoder: (rpcTag) =>
    new EffectRpcQueryConfigError(
      "UnknownKeyEncoder",
      `No payload-bearing RPC exists for key encoder ${rpcTag}`,
      { rpcTag }
    ),
  missingEncoder: (rpcTag) =>
    new EffectRpcQueryConfigError(
      "MissingKeyEncoder",
      `RPC ${rpcTag} requires a safe custom key encoder`,
      { rpcTag }
    ),
};
