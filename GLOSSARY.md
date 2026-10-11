# Effect API Query

These terms describe how the package builds TanStack Query utilities from Effect RPC and HTTP contracts.

## Generated API

**RPC utility tree**:
A nested object built from literal Effect RPC tags. Branches represent RPC namespaces. Unary and streaming leaves provide typed key and option builders.
_Avoid_: Router, generated client

**HTTP utility tree**:
A nested object built from the literal group and endpoint identifiers in an Effect HttpApi. Supported buffered and SSE endpoints provide typed key and option builders. Multipart endpoints support buffered mutations only. Endpoints in top-level groups appear at the root.
_Avoid_: RPC utility tree, generated client

**Query data**:
The successful decoded RPC or HTTP value that TanStack Query receives. Buffered queries and live queries convert successful `undefined` to `null`. Accumulated stream elements and mutation data keep their original values.
_Avoid_: RPC success value when it is `undefined`

**Accumulated streamed query**:
A streaming RPC or HTTP SSE view that caches emitted values in order. It can limit the cache to a recent history. Refetches can reset, append to, or replace the cached sequence.
_Avoid_: Live query, infinite query

**Live query**:
A streaming RPC or HTTP SSE view that caches only the latest emitted value. It converts `undefined` to `null`. Stream completion preserves the latest value. Completion before the first emission produces a package error.
_Avoid_: Accumulated streamed query, subscription

**HTTP metadata view**:
A buffered HTTP query view with decoded query data and an immutable snapshot of the response status and raw string headers. Declared decoded header wrappers remain part of the data.
_Avoid_: Raw response, header-wrapped success

## Payloads and keys

**HTTP request input**:
The decoded request parts that a ready HTTP API client accepts: declared params, query, headers, and payload. Response controls are excluded. RPC payload constructors do not apply to HTTP request input.
_Avoid_: Payload constructor input, wire request

**Payload constructor input**:
The value that a call site passes to an RPC payload Schema constructor. It can omit fields that constructor defaults supply.
_Avoid_: Normalized payload, encoded payload

**Normalized payload**:
The payload Schema's decoded `Type` after its constructor applies defaults and validates the input.
_Avoid_: Payload constructor input, encoded payload

**Query-stable payload Schema**:
An RPC payload Schema whose constructor accepts its normalized value again without changing the value's encoded meaning.
_Avoid_: Deterministic encoder, universally idempotent Schema

**Canonical key payload**:
The immutable, JSON-safe representation of a normalized payload that identifies a cache entry. It is independent of the transport encoding for a protocol.
_Avoid_: Wire payload, raw input

**Key prefix**:
A non-empty tuple of JSON-safe values that the caller supplies to namespace a utility tree. Generated roots append an adapter discriminator. HTTP roots also append the API identifier.
_Avoid_: Automatic namespace, client identity

## Execution and failures

**Cancellable command**:
An application operation with an identifier assigned before work starts, observable progress, and an explicit cancellation request. Its terminal domain state is independent of the TanStack mutation state. Cancellation stops future work without undoing completed work.
_Avoid_: Mutation cancellation, rollback

**Ready RPC client**:
A flat, tag-first Effect RPC client acquired within a Scope. The Scope stays alive while an RPC utility tree uses the client. The caller owns the Scope and disposal.
_Avoid_: Client factory, owned client

**Ready HTTP API client**:
An acquired Effect HttpApiClient. The caller owns its transport, middleware, runtime, and resource lifetime.
_Avoid_: URL client, client factory, owned client

**RPC execution error**:
An `Error` that the package produces when an RPC Effect returns a failed `Exit`. It identifies the RPC and operation. It preserves the complete Effect `Cause` without retaining the input.
_Avoid_: Catch-all adapter error, configuration error

**HTTP execution error**:
An `Error` that the package produces when an HTTP Effect returns a failed `Exit`. It identifies the declared API, group, endpoint, method, and operation. It preserves the complete Effect `Cause`.
_Avoid_: Sanitized Cause, configuration error

**Configuration error**:
An error that rejects invalid utility configuration during preparation or execution.
_Avoid_: RPC execution error

**Key-generation error**:
A synchronous error that occurs while the package derives canonical cache identity from RPC payload constructor input or HTTP request input.
_Avoid_: RPC execution error, configuration error
