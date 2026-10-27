---
title: Migrate to 0.4
description: Replace policy helpers, choose stream retention, and use opaque key payload types.
---

Version 0.4 replaces the separate policy and interceptor helpers with `configureUtils`. Accumulated streams also require an explicit retention choice. Live queries keep their existing call shapes.

## Replace policy and interceptor helpers

Configure a tree, branch, or leaf, then call its usual builders:

```ts
import { configureUtils } from "@ueberbrot/effect-api-query";

const read = configureUtils(rpc.users.read, {
  query: { policy: { staleTime: 30_000 } },
});
const options = read.queryOptions({ input: { id: 1 } });
```

Use these replacements for the removed exports:

| Previous helper | Replacement |
| --- | --- |
| `withQueryPolicy(leaf, view, policy)` | `configureUtils(leaf, { [view]: { policy } })`, then the view's options builder |
| `withMutationPolicy(leaf, policy, options)` | `configureUtils(leaf, { mutation: { policy, ...options } })`, then `mutationOptions` |
| `withQueryInterceptor(leaf, view, interceptor)` | `configureUtils(leaf, { [view]: { interceptors: [interceptor] } })` |
| `withMutationInterceptor(leaf, interceptor)` | `configureUtils(leaf, { mutation: { interceptors: [interceptor] } })` |
| `configureQuery` or `configureMutation` | One `configureUtils` call containing the relevant view and mutation settings |

Use `scoped` for named children of a tree or branch. Defaults apply from broad to specific, followed by call-site options. Leaf callbacks receive their concrete contract types; shared tree and branch policy callbacks receive unknown data, errors, and variables.

Mutation callbacks replace corresponding broader callbacks by default. Set `mutation.callbacks: "compose"` where both must run. Shared callbacks then run before more specific callbacks. Keep `onMutate` at each call site to infer its optimistic result. See [Defaults and Policies](/effect-api-query/guides/query-defaults/) for complete examples.

## Choose accumulated-stream retention

Pass a positive safe integer to keep a recent history, or use `"unbounded"` to retain every emission:

```ts
const recent = rpc.diagnostics.stream.streamedOptions({ maxChunks: 100 });
const complete = rpc.diagnostics.stream.streamedOptions({
  maxChunks: "unbounded",
});
```

Raw accumulated key builders require the same choice. For inputless streams, pass it as the first argument:

```ts
const key = rpc.diagnostics.stream.streamedKey({ maxChunks: "unbounded" });
```

To choose retention once, configure a tree, branch, or leaf:

```ts
const streams = configureUtils(rpc, {
  streamed: { policy: { maxChunks: 100 } },
});
const history = streams.diagnostics.stream.streamedOptions();
const historyKey = streams.diagnostics.stream.streamedKey();
```

Configured keys and options inherit the same retention and publication policy. Call-site options can override it. The first event still publishes immediately. Refetch, batching, cancellation, and cleanup keep their existing behavior.

Equivalent inputs and retention choices keep the same runtime cache identity. Explicit `"unbounded"` uses the previous unlimited-history representation. A different finite bound continues to select a different history.

## Use generated keys and filter projections

Canonical payload slots in generated key types are now `unknown`. Runtime keys remain validated, copied, and frozen JSON. Exact prefixes, view discriminators, and data and error tags remain available.

Use `queryKey`, `infiniteKey`, `streamedKey`, or the matching options' `queryKey` for exact cache access. Use `createQueryFilter` with an explicit projection for partial input matching. Code that reads a payload slot directly must narrow that value before using it.

Native Vue query calls now infer selected data and the complete execution-error union without explicit hook generics. Keep Vue's native initial-data distinction: plain options with a defined seed have defined data, while computed options can keep data optional.
