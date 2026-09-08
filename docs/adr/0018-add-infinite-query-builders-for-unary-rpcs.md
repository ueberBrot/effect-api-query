# Add infinite-query builders for unary RPCs

Status: Accepted. Partially supersedes ADR 0002 through ADR 0005 and ADR 0008.

Unary RPC leaves expose `infiniteKey` and `infiniteOptions` so pagination shares ordinary queries'
key and execution contracts. The mapper converts each `pageParam` to payload constructor input;
the mapped `initialPageParam` determines cache identity. Every page uses the Effect runner and
abort signal and satisfies ADR 0014's payload-stability requirement.

Payload-bearing queries accept `skipToken` as the exact `input`; payloadless RPCs omit the mapper.
Keys and failures use the `infinite` discriminator, and failures preserve the complete Cause.
This extends the earlier builder names, options, keys, and operation metadata.
