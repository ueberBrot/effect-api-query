---
title: RPC Factory
description: Create an RPC utility tree from an RPC group and a ready client.
---

## `createRpcQueryUtils(group, options)`

Pass an Effect RPC group and its ready client to build a frozen utility tree for unary and streaming RPCs.

### Options

| Option | Meaning |
| --- | --- |
| `client` | Ready tag-keyed client from `RpcClient.make(group)`. A flat client also works. The caller owns the client and its Scope. |
| `keyPrefix` | Optional non-empty, JSON-safe tuple. Omit it to use the empty namespace for RPC keys. |
| `runtime` | Pass a ManagedRuntime with no layer initialization error, or a compatible runner function. Supply it when execution needs services. The default runner handles service-free Effects. |
| `keyEncoders` | Synchronous encoders keyed by literal RPC tags. Payloads that need encoding services or contain redacted values require them. Runtime inspection also requires them for opaque encoding middleware. |

```ts
const rpcQuery = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ["web", "v1"] as const,
  runtime,
});
```

The factory validates prefixes, paths, encoders, and the methods of tag-keyed clients without making a request. Branches are frozen. Each leaf is built and frozen on first access. Invalid configuration throws `EffectRpcQueryConfigError`.

Keep the input retained by query options unchanged. See [input ownership](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) for the rules.
