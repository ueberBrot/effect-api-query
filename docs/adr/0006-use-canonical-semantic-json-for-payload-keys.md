# Use canonical semantic JSON for payload keys

Status: Accepted. Implementation ownership clarified by [ADR 0021](0021-share-utility-construction-through-private-modules.md). Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Neither raw constructor input nor transport bytes provide stable semantic cache identity.

## Decision

Query keys use a synchronous JSON representation of the normalized payload. By default, the adapter
constructs the payload and Schema-encodes it. It then copies the encoded value into a deeply frozen
canonical form with sorted object keys and normalized numbers. A typed encoder indexed by tag can
replace Schema encoding.

## Consequences

If a Schema requires encoding services or contains an explicit `Schema.Redacted`, it requires a
custom encoder. This includes redacted values reached through `Schema.suspend`. Callers remain
responsible for other sensitive fields. The adapter rejects values outside strict JSON, including
sparse arrays, cycles, and non-plain objects. Prefixes and encoded payloads also reject objects with
`__proto__` or `constructor` properties at any depth.
