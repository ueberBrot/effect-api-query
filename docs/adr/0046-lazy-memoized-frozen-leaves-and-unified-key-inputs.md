# Lazy-memoized frozen leaves and unified key inputs

Status: Accepted. Partially amends [ADR 0009](0009-build-an-eager-frozen-utility-tree.md) for leaf materialization; eager validation and plain frozen enumerable branches remain accepted.

## Context

Input-bearing `*Key` builders accepted positional `(input, policy?)` arguments while `*Options` builders accepted `{ input, ... }`, causing argument-position shifts on streaming leaves and preventing option-object reuse across `*Key` and `*Options`. Eagerly constructing every leaf object during utility tree creation, configuration, and query-owner tracking also paid full closure allocation cost for unused operations on large contracts. Finally, computing descendant dot-paths by walking `Node[K]` across 1,000 operations triggered O(N^2) type instantiations in `RpcTypes.PathTree`.

## Decision

1. **Unified `{ input, ... }` `*Key` calling convention:** Input-bearing `queryKey`, `metadataKey`, `infiniteKey`, `liveKey`, and `streamedKey` builders across RPC and HTTP accept `{ input: Input | PreparedInput<Input>, ...viewPolicy }`, rejecting positional calls and `skipToken` at compile time and non-object inputs at runtime. Inputless `queryKey()`, `metadataKey()`, `infiniteKey()`, and `liveKey(options?)` keep zero-arg calls; `key()` and `mutationKey()` stay `()`. Unconfigured accumulated streamed query leaves keep required `maxChunks`, becoming optional (while retaining required `input` on input-bearing leaves) once configured via `configureUtils`.
2. **Lazy-memoized frozen leaves (amends ADR 0009):** Factories keep eager atomic validation of prefixes, paths, collisions, key encoders, and object-client methods, and return plain frozen enumerable branch objects without `Proxy`. Each leaf is attached as a non-configurable enumerable own getter that lazily constructs, freezes, and memoizes the leaf on first access, returning the identical frozen leaf reference on repeated reads. `configureUtils` and `QueryOwner.trackUtils` inspect branch descriptors without invoking leaf getters, preserving leaf laziness, eager scope and cross-owner validation, untouched branch reference reuse, and `PreparedInput` ownership.
3. **Zero-runtime phantom `[utilityPaths]` metadata:** Generated RPC and HTTP roots and branches carry an optional zero-runtime phantom `[utilityPaths]` symbol typed from literal tag and endpoint identifier strings (`Tags | ParentPrefixes<Tags>` for RPC, group and endpoint identifiers for HTTP), preserved through `ConfiguredUtils` without indexing unused leaves.

## Consequences

Call sites share the `{ input, ... }` shape across `*Key` and `*Options`. Startup, configuration, and owner tracking avoid materializing unaccessed leaves while retaining plain frozen objects, eager error reporting, and `PreparedInput` ownership. Downstream flat-path policy maps read `[utilityPaths]` in O(N) type instantiations.
