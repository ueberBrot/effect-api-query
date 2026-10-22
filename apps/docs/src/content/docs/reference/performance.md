---
title: Performance and Bundling
description: Factory and key construction costs, measurement workloads, and adapter and application bundles.
---

## Construction

Factories build and freeze the complete RPC or HTTP utility tree when called. Each tree belongs to one ready client and cache owner. A larger contract increases factory work, even when the application uses only a few leaves.

Payload-bearing keys prepare a fresh immutable canonical payload. RPC preparation constructs and Schema-encodes the normalized payload. HTTP preparation encodes the declared request parts. Larger payloads require more preparation work. Executable query options also capture the request and create a fresh query function. Ordinary calls do not memoize payloads or option objects. Explicit prepared inputs can reuse input preparation.

A custom RPC key encoder replaces Schema encoding. Payload construction, JSON validation, canonical copying, and freezing still run. The encoder must preserve every input field that can change the result so cache identity remains correct.

## Repeatable measurements

The optional construction workload measures repository sources:

```sh
vp run construction-baseline
```

The [stream workload](https://github.com/ueberBrot/effect-api-query/blob/main/tests/create-rpc-query-utils-stream-baseline.test.ts) and [transport workload](https://github.com/ueberBrot/effect-api-query/blob/main/examples/server/tests/rpc-transport-overhead.test.ts) measure publication and transport costs. Results are comparable only for the same workload and dependency versions. Elapsed time and memory depend on the machine.

## Adapter and application bundles

The package marks its exports as free of side effects and keeps Effect and Query Core as peers. An application can import one factory or an error guard from the package root. Unused factories and the stream snapshot helper can then be removed by the bundler.

An adapter-only bundle with external peers excludes dependency code. The application's contract Schemas, transport, QueryClient, framework, and other imports contribute to the final bundle. Attributing a size change to the adapter requires a comparison with the same imports and dependency versions.

## Reuse a stable input

When the same large input is used repeatedly, prepare it once:

```ts
import { prepareInput } from "@ueberbrot/effect-api-query";

const prepared = prepareInput(rpc.users.get, { id: 1 });
const key = rpc.users.get.queryKey(prepared);
const options = rpc.users.get.queryOptions({
  input: prepared,
  staleTime: 30_000,
});
```

Preparation runs RPC construction, encoding, and canonical copying once. HTTP accepts decoded request containers in the same helper. Later key and ordinary, metadata, live, or streamed option construction reuses the result. Concrete infinite keys also accept the handle; infinite page mappers continue to return raw input. Mutations accept raw variables only. `InferInput` continues to describe raw application input.

A handle belongs to its exact utility leaf. Using it on another leaf or a separately constructed utility tree throws before execution, even when their contract and prefix match. Configured copies of the original leaf share its owner. Handles are opaque, cannot be serialized for hydration, and retain execution input while reachable.

Keep the retained input and all nested mutable values unchanged. Preparation does not deep-clone arbitrary decoded values. Build a new input and handle when parameters change. Inputless and mutation-only leaves have nothing to prepare. This API avoids automatic identity-based memoization of mutable application objects.

The construction workload reports ordinary and prepared option-building costs separately. Prepared measurements exclude the one-time preparation cost; compare them only when inputs are reused. Fresh option objects and query functions are still allocated.
