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

Choose an encoder carefully: inputs that can produce different RPC results must not collapse to the
same key.

## HTTP requests

Use `createHttpApiQueryUtils` encoders for complete decoded request inputs. HTTP encoders receive
the declared `params`, `query`, `payload`, and `headers` containers; RPC encoders receive a normalized
payload after constructor defaults. Keep each encoder under its literal declaration group and endpoint
identifier, even for a top-level group or an identifier containing dots.

For a `forms` group whose `submit` endpoint accepts either a number encoded as text or a string
encoded as JSON, both alternatives can schema-encode to `"1"`. Their HTTP bodies differ. Preserve
that distinction explicitly:

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
Opaque encoding middleware is treated conservatively at runtime. An encoder supplies identity only;
provide an execution runner independently when the ready client needs services. Encoder entries for
unknown, omitted, or inputless endpoints fail synchronously during factory construction.

Keep ordinary authentication in client middleware. Partition the cache with safe tenant and user
identifiers in `keyPrefix`, for example `['tenant', 'north', 'user', 'ada']`. The factory cannot infer
identity from a client, base URL, or middleware. Retain every safe value that distinguishes results
when excluding a secret.

Return strict `JsonValue` synchronously. The factory copies and freezes the result; it rejects
undefined object members, undefined or sparse array entries, non-finite numbers, cycles, and
non-JSON objects. Custom output does not receive the default HTTP omission or header normalization.
See the [HTTP reference](/effect-rpc-query/reference/http-factory/#cache-identity-and-failures) for
failure codes. Underlying error Causes remain intact and may contain values supplied by Effect.
