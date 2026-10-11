---
title: Performance and Bundling
description: Factory and key construction costs, measurement workloads, and adapter and application bundles.
---

## Construction

Factories build and freeze the complete RPC or HTTP utility tree when called.
Each tree belongs to one ready client and cache owner. A larger contract increases factory work,
even when the application uses only a few leaves.

Payload-bearing keys prepare a fresh immutable canonical payload. RPC preparation constructs
and Schema-encodes the normalized payload. HTTP preparation encodes the declared request parts.
Larger payloads require more preparation work. Executable query options also capture the request
and create a fresh query function. Repeated calls do not memoize payloads or option objects.

A custom RPC key encoder replaces Schema encoding. Payload construction, JSON validation,
canonical copying, and freezing still run. The encoder must preserve every input field that can
change the result so cache identity remains correct.

## Repeatable measurements

The optional construction workload measures repository sources:

```sh
vp run construction-baseline
```

The [stream workload](https://github.com/ueberBrot/effect-api-query/blob/main/tests/create-rpc-query-utils-stream-baseline.test.ts)
and [transport workload](https://github.com/ueberBrot/effect-api-query/blob/main/examples/server/tests/rpc-transport-overhead.test.ts)
measure publication and transport costs. Results are comparable only for the same workload and
dependency versions. Elapsed time and memory depend on the machine.

## Adapter and application bundles

The package marks its exports as free of side effects and keeps Effect and Query Core as peers.
An application can import one factory or an error guard from the package root. Unused factories
and the stream snapshot helper can then be removed by the bundler.

An adapter-only bundle with external peers excludes dependency code. The application's contract
Schemas, transport, QueryClient, framework, and other imports contribute to the final bundle.
Attributing a size change to the adapter requires a comparison with the same imports and dependency versions.
