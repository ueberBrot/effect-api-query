# Simplify factory setup and query owner tracking

Status: Accepted. Partially amends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md), [ADR 0008](0008-use-flat-prefix-matchable-key-tuples.md), and [ADR 0040](0040-add-opt-in-query-owner-retirement.md).

## Context

Single-cache applications repeated setup boilerplate across every utility tree: supplying a required `keyPrefix`, flattening Effect's default `RpcClient` with `{ flatten: true }`, unwrapping `ManagedRuntime.runPromiseExit`, and wiring `configureUtils` interceptors across every query view to register work with a query owner.

## Decision

1. **Optional key prefix (amends ADR 0008):** `createRpcQueryUtils` and `createHttpApiQueryUtils` accept `keyPrefix` as an optional non-empty readonly JSON tuple via separate overloads. Omitting `keyPrefix` defaults `Prefix` to `readonly []`, yielding roots `["rpc"]` and `["http", api.identifier]`. Supplying `[]`, mutable `string[]`, explicit `undefined` under `exactOptionalPropertyTypes`, or an explicit prefix generic without `keyPrefix` is rejected at compile time; `[]` and explicit `undefined` fail with `InvalidKeyPrefix` at runtime.
2. **Dual ready RPC client and unified runtime (amends ADR 0007):** `createRpcQueryUtils` accepts both Effect's default tag-keyed `RpcClient` (primary) and `RpcClient.Flat` (including `makeNoSerialization`), eagerly validates that every RPC tag exists as a function on object clients (`EffectRpcQueryConfigError` with code `InvalidRpcClient`), and keeps `RpcQueryUtils<Group, Prefix, ClientError>` parameterized by `ClientError` while preserving middleware client errors. Both factories and `QueryOwner.wrapRunner` replace `runPromiseExit` with `runtime` (`RuntimeInput<Services>`), accepting either a `RunPromiseExit` function or `{ readonly runPromiseExit }` (including `ManagedRuntime<R, never>` with receiver preserved) while rejecting `ManagedRuntime<R, ER>` when `ER` is not `never`.
3. **Single-call owner tracking (amends ADR 0040):** `QueryOwner` and `QueryOwnerSetup` expose `trackUtils(node)` for any generated root, branch, or leaf. It binds leaf runners through `wrapRunner`, all five query views through `runQuery`, and `mutationFn` through `runMutation`. It composes in either order with `configureUtils`, preserves `ConfiguredUtils` types and `PreparedInput` ownership, is idempotent per owner, and rejects cross-owner rebinding.

## Consequences

Factories remain lifecycle-neutral and callers retain ownership of clients, scopes, and runtimes. Single-cache apps omit `keyPrefix`, pass Effect's default `RpcClient` and `ManagedRuntime` directly, and bind utility trees to a query owner in one call.
