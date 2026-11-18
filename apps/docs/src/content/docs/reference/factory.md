---
title: RPC Factory
description: Create an RPC utility tree from an RPC group and a ready client.
---

## `createRpcQueryUtils(group, options)`

Pass an Effect RPC group and its ready client to build a frozen utility tree for unary and streaming RPCs.

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

The factory validates prefixes, paths, and encoders without making a request. Invalid configuration throws `EffectRpcQueryConfigError`.

Keep the input retained by query options unchanged. See [input ownership](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) for the rules.
