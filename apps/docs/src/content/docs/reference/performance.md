---
title: Performance and Bundling
description: Lazy leaf construction, tree shaking, and input preparation reuse.
---

## Construction and tree shaking

Each factory validates the full contract and freezes its branches before it returns. Each leaf builds and freezes on first access. If your application uses only a few endpoints from a large contract, the unused leaves never build.

Effect and Query Core are peer dependencies. The package marks its exports as free of side effects, so your bundler can drop unused factories and helpers.

`configureUtils` copies policy objects and interceptor lists. It reuses frozen subtrees when no new settings apply to them. Create the utility tree and apply `configureUtils` once per cache owner, then reuse the result across renders.

## Reuse a prepared input

Each input-bearing key builder encodes and freezes fresh JSON. Each options builder also retains the input and creates a query function. If several builders reuse the same large input, call `prepareInput` once.

```ts
import { prepareInput } from "@ueberbrot/effect-api-query";

const prepared = prepareInput(rpc.users.get, { id: 1 });
const key = rpc.users.get.queryKey({ input: prepared });
const options = rpc.users.get.queryOptions({
  input: prepared,
  staleTime: 30_000,
});
```

`prepareInput` runs payload construction, encoding, and copying once. For HTTP, pass decoded request parts. Pass the handle to exact keys and to `queryOptions`, `metadataOptions`, `liveOptions`, `streamedOptions`, or `infiniteKey`. Infinite page mappers and mutations take raw input.

A prepared handle works only with the leaf that created it and with configured copies of that leaf. Other leaves and utility trees reject it before execution. Keep retained input values unchanged, including nested objects and arrays. When parameters change, build new input and call `prepareInput` again.
