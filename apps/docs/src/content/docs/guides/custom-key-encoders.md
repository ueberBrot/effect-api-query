---
title: Custom Key Encoders
description: Supply safe semantic identity for RPC payloads and HTTP requests.
---

## RPC payloads

By default, the factory constructs the RPC payload and synchronously encodes it with its Schema.
Supply a custom encoder when encoding requires Effect services or the payload contains
`Schema.Redacted` values, including schemas reached through `Schema.suspend`.

```ts
const rpcQuery = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ['admin'] as const,
  keyEncoders: {
    'secrets.read': (payload) => ({ secretId: identifySecret(payload.secret) }),
  },
  runPromiseExit,
})
```

An encoder receives the normalized payload and must return a strict `JsonValue` synchronously. It
must not reveal secrets. Return a stable public identifier, digest, or other safe semantic identity.

Define encoders as own enumerable properties keyed by literal payload-bearing RPC tags. TypeScript
requires entries for unsafe payloads; the factory also rejects missing or unknown entries at runtime.

Inputs that can produce different RPC results must produce different keys.

## HTTP requests

HTTP encoders receive the complete decoded request input: the declared `params`, `query`,
`payload`, and `headers` containers. RPC encoders receive the normalized payload after constructor
defaults. Configure each HTTP encoder in `createHttpApiQueryUtils` under its literal declaration
group and endpoint identifier, even for a top-level group or an identifier containing dots.

Suppose a `forms` group's `submit` endpoint accepts a number encoded as text or a string encoded
as JSON. Both schemas can encode to `"1"`, but the HTTP bodies differ. Preserve that distinction
in the key:

```ts
const http = createHttpApiQueryUtils(contract, {
  client,
  keyPrefix: ['forms'],
  keyEncoders: {
    forms: {
      submit: ({ payload }) => ({
        format: typeof payload === 'number' ? 'text' : 'json',
        value: String(payload),
      }),
    },
  },
})
```

Multiple buffered alternatives require an encoder even when they share a content type. For buffered
binary input, return a JSON-safe representation such as `{ bytes: Array.from(payload) }`; the ready
client still receives the original `Uint8Array`.

Encoding services or explicit `Redacted` values in any request part also require an encoder.
The factory treats opaque encoding middleware conservatively at runtime. An encoder supplies
identity only; the ready client still needs an execution runner when it requires services. The
factory synchronously rejects encoder entries for unknown, omitted, or inputless endpoints during
construction.

Keep ordinary authentication in client middleware. Partition the cache with safe tenant and user
identifiers in `keyPrefix`, for example `['tenant', 'north', 'user', 'ada']`. The factory cannot infer
identity from a client, base URL, or middleware. Retain every safe value that distinguishes results
when excluding a secret.

Return strict `JsonValue` synchronously. The factory copies and freezes the result; it rejects
undefined object members, undefined or sparse array entries, non-finite numbers, cycles, and
non-JSON objects. Custom output does not receive the default HTTP omission or header normalization.
See the [HTTP reference](/effect-api-query/reference/http-factory/#cache-identity-and-failures) for
failure codes. Underlying error Causes remain intact and may contain values supplied by Effect.

The [public RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/public-contract.ts) and
[public HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts) check encoder inputs and required services.
The [HTTP key tests](https://github.com/ueberBrot/effect-api-query/blob/main/tests/http-semantic-keys.test.ts) verify alternative payload and binary projections.
