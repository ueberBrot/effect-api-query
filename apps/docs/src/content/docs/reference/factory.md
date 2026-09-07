---
title: RPC Factory
description: Create an RPC utility tree from an RPC group and a ready client.
---

## `createRpcQueryUtils(group, options)`

Returns an eager, frozen `RpcQueryUtils` tree for the group's unary and streaming RPCs.

### Options

| Option           | Meaning                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `client`         | Ready flat RPC client. The caller owns its `Scope` and lifecycle.                                                      |
| `keyPrefix`      | Non-empty, JSON-safe tuple that namespaces every generated key.                                                        |
| `runPromiseExit` | Runner used for RPC Effects. Required when client-side services remain; otherwise defaults to `Effect.runPromiseExit`. |
| `keyEncoders`    | Synchronous encoders keyed by literal RPC tags. Required for serviceful or redacted payloads.                          |

```ts
const rpcQuery = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ['web', 'v1'] as const,
  runPromiseExit,
})
```

The factory throws `EffectRpcQueryConfigError` for an invalid prefix, RPC path collision, reserved
path segment, or invalid encoder map. It performs no network request.

The [public RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/public-contract.ts) checks factory inference and runner requirements.
