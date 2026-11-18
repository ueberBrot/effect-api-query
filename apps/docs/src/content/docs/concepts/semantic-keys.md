---
title: Semantic Keys
description: Learn how normalized payloads produce stable cache identity.
---

The library constructs an RPC payload before it builds the query key. The key includes values supplied by constructor defaults.

```ts
rpcQuery.users.get.queryKey({ id: 1 });
rpcQuery.users.get.queryKey({ id: 1, locale: "en" });
```

If the RPC payload Schema supplies `locale: 'en'` as a constructor default, both calls produce the same canonical key.

The library builds the key in four steps.

1. Construct the payload from the input.
2. Encode the payload synchronously with its Schema.
3. Sort object keys at every level to get a consistent JSON value.
4. Store that value at the end of the query key.

Configure key hashing on QueryClient before adding cache entries. Generated builders reject individual `queryKeyHashFn` and `queryHash` overrides. Fetches, stream publications, and native cache reads and writes then use the same entry. If a change to hashing conflicts with an existing stream key, stream execution fails with `UnsupportedQueryHash`.

Key objects cannot contain `__proto__` or `constructor` properties at any depth. Prefixes, Schema output, and custom encoder output all follow this restriction.

RPC keys begin with the caller prefix followed by `rpc`. HTTP keys begin with the caller prefix, `http`, and the HttpApi identifier. A factory's `key()` includes these generated segments.

The operation follows the RPC path. It is `query`, `infinite`, `streamed`, `live`, or `mutation`. Exact query keys also include the encoded payload, if present. The public payload slot is `unknown`. Use builders for exact keys and explicit projections for partial filters. The library validates and freezes each payload. A root, branch, or RPC prefix matches the operations below it.

An accumulated stream key includes the retention and refetch settings. Use a finite `maxChunks` or `"unbounded"`, either at the call site or through a policy. Unbounded retention with reset refetches uses the original unlimited-history key. Pass the same settings to `streamedKey` and `streamedOptions` for exact cache access. Use the endpoint prefix to match every view. Use builders to produce the suffix.

Applications that persist query data choose schema and key-version busters as described in [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/).

Unsupported values, failed construction, and failed encoding raise `EffectRpcQueryKeyError` before network execution. Payloads that need encoding services or contain redacted values require a [custom key encoder](/effect-api-query/guides/custom-key-encoders/).

HTTP keys use decoded request input. The library encodes each declared part, drops `undefined` object members, normalizes header names, and freezes the JSON. Labels keep the query and payload distinct even if both add URL parameters. The key reflects the declared request and its encoding rules.

If middleware changes results by user, tenant, or another identity, include a safe identifier in the prefix. See [HTTP cache identity](/effect-api-query/reference/http-builders/#cache-identity-and-failures) and [HTTP key encoders](/effect-api-query/guides/custom-key-encoders/#http-requests).
