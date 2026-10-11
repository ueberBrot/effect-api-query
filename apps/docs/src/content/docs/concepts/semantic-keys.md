---
title: Semantic Keys
description: Learn how normalized payloads produce stable cache identity.
---

For a payload-bearing RPC query, the factory constructs the payload before it creates the key.
Cache identity therefore includes constructor defaults:

```ts
rpcQuery.users.get.queryKey({ id: 1 })
rpcQuery.users.get.queryKey({ id: 1, locale: 'en' })
```

If the RPC payload Schema supplies `locale: 'en'` as a constructor default, both calls produce
the same canonical key.

Default key preparation follows these steps:

1. Construct the normalized payload from constructor input.
2. Encode it synchronously with the payload Schema.
3. Canonicalize strict JSON by sorting object keys recursively.
4. Store the canonical key payload in a flat, prefix-matchable query key.

QueryClient owns hashing through its global and prefix defaults. Generated options omit hash
fields so fetches, stream publications, and native `getQueryData` and `setQueryData` calls address
the same cache entry. Builders reject per-call `queryKeyHashFn` and `queryHash` overrides.
Configure hashing before you use the cache, and keep it stable while entries remain.
If changed hashing conflicts with a matching cached entry, stream execution rejects with
`UnsupportedQueryHash`.

Key objects cannot contain `__proto__` or `constructor` properties at any depth.
Prefixes, Schema output, and custom encoder output all follow this restriction.

RPC keys begin with the caller prefix followed by `rpc`. HTTP keys begin with the caller prefix,
`http`, and the HttpApi identifier. A factory's `key()` includes these generated segments.

Every RPC operation adds a segment after the RPC path: `query`, `infinite`, `streamed`, `live`, or
`mutation`. Concrete query keys append the canonical payload when the RPC has one.
The operation segments keep different cache shapes from colliding. Root, branch, and RPC prefixes
still match all descendant operations.

Accumulated-stream keys also include normalized retention and refetch policy. Unlimited retention
with reset refetches is the default identity. Different bounds or modes have separate cache entries.
For exact cache access, supply the same policy to `streamedKey` and `streamedOptions`.
Broad prefixes still match all views. Treat the concrete suffix as opaque.

Applications that persist query data choose schema and key-version busters as described in
[Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/).

Unsupported values, failed construction, and failed encoding raise `EffectRpcQueryKeyError` before
network execution. Payloads that need encoding services or contain redacted values require a
[custom key encoder](/effect-api-query/guides/custom-key-encoders/).

HTTP keys use the endpoint's decoded request input without RPC construction. Default preparation
encodes each labeled request part with its schema. It omits encoded `undefined` object members,
normalizes header names, and freezes canonical JSON. Labels distinguish query and payload even
when both contribute URL parameters. The key reflects the declared request. It does not infer
every possible equivalence between HTTP requests.

Client middleware does not contribute to the declared identity. If user, tenant, or other
identifiers affect results, include safe values in the caller prefix. The
[HTTP factory reference](/effect-api-query/reference/http-builders/#cache-identity-and-failures) and
[HTTP encoder guide](/effect-api-query/guides/custom-key-encoders/#http-requests) describe the complete rules.
