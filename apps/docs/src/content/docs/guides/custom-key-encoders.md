---
title: Custom Key Encoders
description: Supply safe semantic identity for RPC payloads and HTTP requests.
---

## RPC payloads

By default, the factory constructs the RPC payload and synchronously encodes it with its Schema. If encoding requires Effect services or uses opaque encoding middleware, supply a custom encoder. Payloads containing `Schema.Redacted` values also require one, including schemas reached through `Schema.suspend`. The runtime check treats middleware conservatively, even when it is synchronous and service-free.

In your application client module, configure the ready RPC client. This example uses `identifySecret` to synchronously produce a public identity:

```ts
const rpcQuery = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ["admin"] as const,
  keyEncoders: {
    "secrets.read": (payload) => ({ secretId: identifySecret(payload.secret) }),
  },
  runPromiseExit,
});
```

An encoder receives the normalized payload. It must synchronously return a strict `JsonValue` without revealing secrets. Return a stable public identifier, digest, or other safe semantic identity.

Broad payload declarations such as `Schema.Unknown`, `Schema.Any`, and void-containing unions accept encoders too. Their default keys still require strict JSON. Accepted RPC inputs such as `undefined`, a bigint, or a class instance can require an encoder to supply JSON-safe identity.

Define encoders as own enumerable properties keyed by literal payload-bearing RPC tags. TypeScript requires entries for unsafe payloads. The factory also rejects missing or unknown entries at runtime.

Inputs that can produce different RPC results must produce different keys.

## HTTP requests

HTTP encoders receive the complete decoded request input: the declared `params`, `query`, `payload`, and `headers` containers. RPC encoders receive the normalized payload after the constructor applies defaults. Configure each HTTP encoder in `createHttpApiQueryUtils` under its literal declaration group and endpoint identifier, even for a top-level group or an identifier containing dots.

Suppose the `forms` group's `submit` endpoint accepts a number encoded as text or a string encoded as JSON. Both schemas can encode to `"1"`, but the HTTP bodies differ. In your HTTP client module, configure the endpoint's request projection to preserve that distinction:

```ts
const http = createHttpApiQueryUtils(contract, {
  client,
  keyPrefix: ["forms"],
  keyEncoders: {
    forms: {
      submit: ({ payload }) => ({
        format: typeof payload === "number" ? "text" : "json",
        value: String(payload),
      }),
    },
  },
});
```

Multiple non-multipart buffered alternatives require an encoder, even when they share a content type. For buffered binary input, return a JSON-safe representation such as `{ bytes: Array.from(payload) }`. The ready client still receives the original `Uint8Array`.

Encoding services or explicit `Redacted` values in any request part also require an encoder. The factory treats opaque encoding middleware conservatively at runtime. An encoder supplies identity only. If the ready client requires services, it still needs an execution runner. During construction, the factory synchronously rejects encoder entries for unknown, omitted, inputless, or mutation-only endpoints.

Buffered multipart endpoints expose mutation builders only and require no query identity encoder, including endpoints with mixed plain and multipart payload alternatives. Keep these endpoints out of `keyEncoders`. Pass `FormData` directly to their mutation.

Keep ordinary authentication in client middleware. Partition the cache with safe tenant and user identifiers in `keyPrefix`, for example `['tenant', 'north', 'user', 'ada']`. The factory cannot infer identity from a client, base URL, or middleware. When excluding a secret, retain every safe value that distinguishes results.

Return strict `JsonValue` synchronously. The factory copies and freezes the result. It rejects undefined object members, undefined or sparse array entries, non-finite numbers, cycles, and non-JSON objects. Custom output bypasses the default HTTP rules for omitting `undefined` members and normalizing headers. See the [HTTP reference](/effect-api-query/reference/http-builders/#cache-identity-and-failures) for failure codes. Underlying error Causes remain intact and can contain values supplied by Effect.
