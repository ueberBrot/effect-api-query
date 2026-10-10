---
title: Performance and Bundling
description: Construction costs, source workloads, and the distinction between adapter and application bundles.
---

## Construction

Factories eagerly build and freeze the complete RPC or HTTP utility tree. Build each tree once
for its ready client and cache owner. A larger contract increases factory work even when an
application uses only a few leaves.

Payload-bearing keys prepare a fresh immutable canonical payload. RPC preparation constructs
and Schema-encodes the normalized payload; HTTP preparation encodes the declared request parts.
Larger payloads increase this work. Executable query options also capture the request and create a fresh
query function. Repeated calls do not memoize payloads or option objects.

A custom RPC key encoder replaces Schema encoding. Payload construction, JSON validation,
canonical copying, and freezing still run. Choose an encoder for correct semantic identity;
it must preserve every input field that can change the result.

## Repeatable measurements

Run the optional construction workload against repository sources:

```sh
vp run construction-baseline
```

The [stream workload](https://github.com/ueberBrot/effect-api-query/blob/main/tests/create-rpc-query-utils-stream-baseline.test.ts)
and [transport workload](https://github.com/ueberBrot/effect-api-query/blob/main/examples/server/tests/rpc-transport-overhead.test.ts)
measure publication and transport costs. Compare the same workload and dependency versions;
elapsed time and memory depend on the machine.

## Adapter and application bundles

The package marks its exports as free of side effects and keeps Effect and Query Core as peers.
An application can import one factory or an error guard from the package root. Unused factories
and the stream snapshot helper can then be removed by the bundler.

An adapter-only bundle with peers external excludes dependency code. An application's contract
Schemas, transport, QueryClient, framework, and other imports contribute to its final bundle.
Compare the same imports and dependency versions before attributing a size change to the adapter.
