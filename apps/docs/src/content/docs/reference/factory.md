---
title: RPC Factory
description: Create an RPC utility tree from an RPC group and a ready client.
---

## `createRpcQueryUtils(group, options)`

The factory builds and freezes a `RpcQueryUtils` tree for the group's unary and streaming RPCs when called.

### Options

| Option | Meaning |
| --- | --- |
| `client` | Ready flat RPC client whose `Scope` and lifecycle belong to the caller. |
| `keyPrefix` | Non-empty, JSON-safe tuple that namespaces every generated key. |
| `runPromiseExit` | Runner for RPC Effects. It is required when client-side services remain. Otherwise, it defaults to `Effect.runPromiseExit`. |
| `keyEncoders` | Synchronous encoders keyed by literal RPC tags. Payloads that need encoding services or contain redacted values require them. Runtime inspection also requires them for opaque encoding middleware. |

```ts
const rpcQuery = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ["web", "v1"] as const,
  runPromiseExit,
});
```

An invalid prefix, RPC path collision, reserved path segment, or invalid encoder map causes `EffectRpcQueryConfigError`. Factory construction performs no network request.

Query options retain the normalized payload for execution. Captured values must stay unchanged. See [Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) for the distinction between immutable keys and caller-owned input.
