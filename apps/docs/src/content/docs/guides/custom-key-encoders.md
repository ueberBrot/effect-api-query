---
title: Custom Key Encoders
description: Supply safe semantic identity for RPC payloads and HTTP requests.
---

## RPC payloads

Use a custom encoder when default key encoding needs services or includes a `Schema.Redacted` value. This includes schemas reached through `Schema.suspend`. The factory also treats opaque encoding middleware as unsafe, even if it runs synchronously without services.

Configure the encoder where you create the utility tree. Here `identifySecret` returns a public identifier without revealing the secret.

```ts
const rpcQuery = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ["admin"] as const,
  keyEncoders: {
    "secrets.read": (payload) => ({ secretId: identifySecret(payload.secret) }),
  },
  runtime,
});
```

The encoder receives the normalized payload. Return a stable, safe `JsonValue` synchronously, such as a public identifier or digest.

Broad declarations such as `Schema.Unknown`, `Schema.Any`, and void-containing unions can use encoders too. If a usable RPC input such as a bigint or class instance fails JSON validation, supply an encoder.

Use own enumerable properties keyed by literal payload-bearing RPC tags. TypeScript requires entries for unsafe payloads. The factory also rejects missing and unknown entries at runtime.

Inputs that can produce different RPC results must produce different keys.

## HTTP requests

HTTP encoders receive the full decoded request. Configure them under the declaration's literal group and endpoint names. Use the original group name for top-level groups and keep dots in identifiers.

This `forms.submit` endpoint accepts a number as text or a string as JSON. Both schemas can encode to `"1"`, so include a discriminator to keep their keys distinct.

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

Supply an encoder for multiple buffered nonmultipart payload alternatives, even when they share a content type. For binary input, you can return `{ bytes: Array.from(payload) }`. Execution still uses the original `Uint8Array`.

HTTP input also needs an encoder if key encoding needs services or contains explicit `Redacted` values. Opaque encoding middleware follows the same conservative rule. Supply execution services through the runner separately. The factory rejects encoders for unknown, omitted, inputless, and mutation-only endpoints.

Buffered multipart endpoints are mutation-only, including those that also accept plain payloads. Pass `FormData` to the mutation. Leave the endpoint out of `keyEncoders`.

Keep authentication in the client. If identity changes the result, include safe identifiers in `keyPrefix`, such as `['tenant', 'north', 'user', 'ada']`. Preserve every safe value that distinguishes responses when you exclude a secret.

Return strict JSON synchronously. The factory copies and freezes it. It rejects `undefined`, sparse arrays, non-finite numbers, cycles, and non-JSON objects. With a custom encoder, omit optional members and normalize headers yourself if your key requires it. See [HTTP key errors](/effect-api-query/reference/http-builders/#cache-identity-and-failures). Effect Causes can include application values.
