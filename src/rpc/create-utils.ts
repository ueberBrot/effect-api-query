import type { RpcGroup } from "effect/rpc";

import type { RuntimeKeyEncoder } from "../core/operation";
import type { KeyPrefix, OptionalKeyPrefix, RuntimeInput } from "../core/types";
import { createUtilityTree } from "../core/utility-tree";
import { extractRpcs, rpcTreeErrors } from "./operation";
import type {
  CreateRpcQueryUtilsClientOptions,
  CreateRpcQueryUtilsOptions,
  ExtractRpcClientError,
  ReadyRpcClient,
  RpcQueryUtils,
  RpcsOf,
} from "./types";

/**
 * Derives a frozen TanStack Query utility tree with lazy-memoized leaves from an Effect RPC group.
 *
 * Dotted RPC tags become nested properties with unary or streaming utility leaves.
 * Accepts both default tag-keyed `RpcClient` and `RpcClient.Flat` clients.
 * The caller retains ownership of the ready client's Scope and lifecycle.
 *
 * @throws {@link EffectRpcQueryConfigError} if the client, prefix, paths, or encoders are invalid.
 */
export function createRpcQueryUtils<
  const Group extends RpcGroup.Any,
  Client extends ReadyRpcClient<RpcsOf<Group>, unknown>,
>(
  group: Group,
  options: CreateRpcQueryUtilsClientOptions<Group, readonly [], Client>
): RpcQueryUtils<Group, readonly [], ExtractRpcClientError<Group, Client>>;
export function createRpcQueryUtils<
  const Group extends RpcGroup.Any,
  const Prefix extends KeyPrefix,
  ClientError = never,
>(
  group: Group,
  options: CreateRpcQueryUtilsOptions<Group, Prefix, ClientError>
): RpcQueryUtils<Group, Prefix, ClientError>;
export function createRpcQueryUtils<
  const Group extends RpcGroup.Any,
  const Prefix extends KeyPrefix,
  Client extends ReadyRpcClient<RpcsOf<Group>, unknown>,
>(
  group: Group,
  options: CreateRpcQueryUtilsClientOptions<Group, Prefix, Client>
): RpcQueryUtils<Group, Prefix, ExtractRpcClientError<Group, Client>>;
export function createRpcQueryUtils(
  group: RpcGroup.Any,
  options: {
    readonly client: object;
    readonly keyPrefix?: OptionalKeyPrefix | undefined;
    readonly keyEncoders?:
      | Readonly<Record<string, RuntimeKeyEncoder | undefined>>
      | undefined;
    readonly runtime?: RuntimeInput | undefined;
  }
): object {
  const rpcs = extractRpcs(group, options.client);
  const hasKeyPrefix = Object.hasOwn(options, "keyPrefix");
  const keyEncoders = new Map<string, RuntimeKeyEncoder>();
  for (const [tag, encoder] of Object.entries(options.keyEncoders ?? {})) {
    if (encoder !== undefined) {
      keyEncoders.set(tag, encoder);
    }
  }
  return createUtilityTree(rpcs, {
    hasKeyPrefix,
    keyPrefix: options.keyPrefix,
    keyNamespace: ["rpc"],
    keyEncoders,
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
    runtime: options.runtime as RuntimeInput<unknown> | undefined,
    errors: rpcTreeErrors,
  });
}
