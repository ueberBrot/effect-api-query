# Add infinite-query builders for unary RPCs

Status: Accepted. Partially supersedes ADR 0002 through ADR 0005 and ADR 0008.

Unary RPC leaves expose `infiniteKey` and `infiniteOptions`. Pagination shares the key and execution
contracts of ordinary queries. The mapper converts each `pageParam` to payload constructor input.
The mapped `initialPageParam` determines cache identity. Every page uses the Effect runner and
abort signal and satisfies ADR 0014's payload-stability requirement.

Payload-bearing queries accept `skipToken` as the exact `input`. Payloadless RPCs omit the mapper.
Keys and failures use the `infinite` discriminator. Failures preserve the complete Cause.
These additions extend the earlier builder names, options, keys, and operation metadata.
