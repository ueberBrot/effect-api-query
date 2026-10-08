# Expose buffered multipart HTTP mutations

Status: Accepted. Amends [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md) and extends [ADR 0021](0021-share-utility-construction-through-private-modules.md).

Buffered multipart uploads need mutation execution without query cache identity for files or
`FormData`. Expose only `key()`, `mutationKey()`, and `mutationOptions()` when an endpoint has any
buffered multipart payload alternative and all its successes are buffered. Preserve Effect's client
request shape, including `FormData` for multipart payloads and the upstream union for mixed payload
alternatives. Any streaming success or streaming multipart payload still omits the whole endpoint.

Mutation-only endpoints require no key encoder and reject configured encoders because their
variables never enter cache identity. They retain decoded-only responses, caller-owned runners and
resources, typed callbacks, and complete failed-Exit Causes. HTTP method does not change this
capability boundary.

The shared private utility construction supports mutation-only operation descriptions; adapters
continue to own endpoint classification and request types. Keep public factories and packed
compile-time fixtures as the test seams, with runtime tests for request forwarding and execution.
