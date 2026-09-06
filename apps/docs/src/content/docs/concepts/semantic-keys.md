---
title: Semantic Keys
description: Learn how normalized payloads produce stable cache identity.
---

For a payload-bearing RPC query, the factory constructs the payload before creating its key. Constructor
defaults therefore become part of cache identity:

```ts
rpcQuery.users.get.queryKey({ id: 1 })
rpcQuery.users.get.queryKey({ id: 1, locale: 'en' })
```

If the RPC payload Schema supplies `locale: 'en'` as a constructor default, these calls produce the
same canonical key.

The default process is:

1. Construct the normalized payload from constructor input.
2. Encode it synchronously with the payload Schema.
3. Canonicalize strict JSON by sorting object keys recursively.
4. Store the canonical key payload in a flat, prefix-matchable query key.

The generated `queryKeyHashFn` serializes the already-canonical key so TanStack Query uses the same
identity as the key builders.

Key objects cannot contain `__proto__` or `constructor` properties at any depth. This applies to
prefixes, Schema output, and custom encoder output.

RPC keys begin with the caller prefix followed by `rpc`. HTTP keys begin with the caller prefix,
`http`, and the HttpApi identifier. A factory’s `key()` includes these generated segments.

Every RPC operation adds its own segment after the RPC path: `query`, `infinite`, `streamed`, `live`, or
`mutation`. Concrete query keys append the canonical payload when the RPC has one. These segments
keep different cache shapes from colliding while root, branch, and RPC prefixes continue to match
all descendant operations.

Unsupported values, failed construction, and failed encoding raise `EffectRpcQueryKeyError` before
network execution. Serviceful or redacted payloads require a
[custom key encoder](/effect-rpc-query/guides/custom-key-encoders/).

HTTP keys use the endpoint's decoded request input without RPC construction. Default preparation
schema-encodes the labelled request parts, omits encoded undefined object members, normalizes header
names, and then freezes canonical JSON. Labels preserve distinctions between query and payload even
when both contribute URL parameters. The key represents declared request meaning, rather than
trying to infer every possible equivalence between HTTP requests.

Client middleware is outside that declared identity. Use safe user, tenant, or other identity
partitions in the caller prefix when they affect results. See the
[HTTP factory reference](/effect-rpc-query/reference/http-factory/#cache-identity-and-failures) and
[HTTP encoder guide](/effect-rpc-query/guides/custom-key-encoders/#http-requests) for the complete rules.
