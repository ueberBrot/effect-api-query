# Effect API Query

This glossary defines the project-specific language for deriving TanStack Query utilities from Effect RPC and HTTP contracts.

## Generated API

**RPC utility tree**:
A nested object derived from literal Effect RPC tags. Branches represent RPC namespaces; unary and streaming leaves provide their typed key and option builders.
_Avoid_: Router, generated client

**HTTP utility tree**:
A nested object derived from an Effect HttpApi's literal group and endpoint identifiers. Buffered endpoints provide typed key and option builders; endpoints in top-level groups appear at the root.
_Avoid_: RPC utility tree, generated client

**Query data**:
The successful decoded RPC or HTTP value presented to TanStack Query. Buffered queries convert successful `undefined` to `null`; streamed values and mutation data remain unchanged.
_Avoid_: RPC success value when it is `undefined`

**Accumulated streamed query**:
A streaming RPC view that caches emitted values in order, optionally retaining only a bounded recent history. Refetches may reset, append to, or replace the cached sequence.
_Avoid_: Live query, infinite query

**Live query**:
A streaming RPC view that caches only the latest emitted value. Stream completion preserves that value; completion before the first emission produces a package error.
_Avoid_: Accumulated streamed query, subscription

## Payloads and keys

**HTTP request input**:
The decoded request parts accepted by a ready HTTP API client: declared params, query, headers, and payload. It excludes response controls; RPC payload constructors do not apply to it.
_Avoid_: Payload constructor input, wire request

**Payload constructor input**:
The call-site value accepted by an RPC payload Schema constructor. It may omit fields supplied by constructor defaults.
_Avoid_: Normalized payload, encoded payload

**Normalized payload**:
The payload Schema's decoded `Type` after the constructor applies defaults and validates the input.
_Avoid_: Payload constructor input, encoded payload

**Query-stable payload Schema**:
An RPC payload Schema whose normalized value can pass through its constructor again without changing its encoded meaning.
_Avoid_: Deterministic encoder, universally idempotent Schema

**Canonical key payload**:
The immutable, JSON-safe representation of a normalized payload used for cache identity. It is independent of protocol-specific transport encoding.
_Avoid_: Wire payload, raw input

**Key prefix**:
A caller-supplied, non-empty tuple of JSON-safe values that namespaces a utility tree. Generated roots append an adapter discriminator and, for HTTP, the API identifier.
_Avoid_: Automatic namespace, client identity

## Execution and failures

**Cancellable command**:
An application operation identified before work starts, with observable progress and an explicit cancellation request. Its terminal domain state is independent of the TanStack mutation state; cancellation stops future work without undoing completed work.
_Avoid_: Mutation cancellation, rollback

**Ready RPC client**:
A flat, tag-first Effect RPC client acquired within a Scope that remains alive while an RPC utility tree uses it. The caller owns the Scope and disposal.
_Avoid_: Client factory, owned client

**Ready HTTP API client**:
An acquired Effect HttpApiClient whose transport, middleware, runtime, and resource lifetime belong to the caller.
_Avoid_: URL client, client factory, owned client

**RPC execution error**:
An `Error` produced when an RPC Effect returns a failed `Exit`. It identifies the RPC and operation and preserves the complete Effect `Cause` without retaining the input.
_Avoid_: Catch-all adapter error, configuration error

**HTTP execution error**:
An `Error` produced when an HTTP Effect returns a failed `Exit`. It identifies the declared API, group, endpoint, method, and operation and preserves the complete Effect `Cause`.
_Avoid_: Sanitized Cause, configuration error

**Configuration error**:
A synchronous error that rejects invalid configuration for a utility tree or its option builders.
_Avoid_: RPC execution error

**Key-generation error**:
A synchronous error produced while deriving canonical cache identity from RPC payload constructor input or HTTP request input.
_Avoid_: RPC execution error, configuration error
