# Add buffered HTTP utilities with separate key roots

Status: Accepted. Amends ADR 0001, ADR 0003, ADR 0005 through ADR 0008, ADR 0013, and ADR 0021.

Publish one `effect-api-query` package at the workspace root. Export `createHttpApiQueryUtils` beside
`createRpcQueryUtils` through one package root. Private adapters share utility construction but retain
their distinct request and projection contracts.
Use `src/core`, `src/http`, and `src/rpc` with direct imports and explicit root exports.

HTTP mirrors literal group/endpoint names, including dots and top-level projection. Omit an entire
endpoint if any success alternative streams (including header-wrapped streams) or any payload
alternative is multipart; omit empty groups. This prevents falsely buffered result types. Unsafe
paths, collisions, and contradictory multipart metadata fail atomically.

Accept decoded request parts and force decoded-only responses. Preserve query normalization and
mutation data. Applications own ready-client resources and supply runners for encoding, decoding,
and residual client services; key encoders supply only cache identity. HTTP-specific errors retain
declaration metadata and untouched failed-Exit Causes, which may contain upstream request, response,
or Schema issue values. Runner rejections pass through.

Keys append `rpc` plus tag segments, or `http` plus API identifier and projected path, after the
caller prefix. Operation and canonical query input follow. Factory `key()` includes this generated
root, preventing cross-adapter collisions while retaining prefix invalidation. Applications own
safe client-identity partitions and deliberate cross-adapter invalidation through the caller prefix.

See the [HTTP technical reference](../research/http-technical-spine.md) for upstream assumptions and
executable evidence.
