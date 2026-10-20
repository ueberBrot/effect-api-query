import { Stream } from "effect";

import type { StreamingOperation } from "../core/operation";
import { makeStreamQuery, prepareStreamPolicy } from "../core/streamed-query";
import {
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
} from "./errors";

export interface RpcStreamInvocation {
  readonly tag: string;
  readonly invoke: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters
    input: unknown,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters
    options: unknown
  ) => Stream.Stream<unknown, unknown, unknown>;
}

export const createStreamPreparation =
  (rpc: RpcStreamInvocation): StreamingOperation["prepareStream"] =>
  (options, operation, runPromiseExit, requestOptions) => {
    const { policy, history } = prepareStreamPolicy(
      options,
      operation,
      (code, message) =>
        new EffectRpcQueryConfigError(code, message, { rpcTag: rpc.tag })
    );
    return {
      identity: history === undefined ? [] : [Object.freeze(history)],
      makeQuery: (input) =>
        makeStreamQuery({
          policy,
          source: Stream.suspend(() => rpc.invoke(input, requestOptions)),
          executionError: (cause) =>
            new EffectRpcQueryError(rpc.tag, operation, cause),
          unsupportedHash: () =>
            new EffectRpcQueryConfigError(
              "UnsupportedQueryHash",
              "Stream queries require consistent QueryClient hashing",
              { rpcTag: rpc.tag }
            ),
          emptyError: () => new EffectRpcQueryEmptyStreamError(rpc.tag),
          runPromiseExit,
        }),
    };
  };
