---
title: Performance and Bundling
description: Construction costs, compiler measurements, and the distinction between adapter and application bundles.
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

Maintainers can save a report while verifying the packed package:

```sh
EFFECT_API_QUERY_BASELINE=.artifacts/packed-baseline.json vp run --no-cache packed-package
```

The report separates construction, compiler, and bundle costs for the installed package. Compare
unchanged workloads and dependency versions; elapsed time and memory are observations, not
universal thresholds.

## Adapter and application bundles

The package marks its exports as free of side effects and keeps Effect and Query Core as peers.
An application can import one factory or an error guard from the package root. Unused factories
and the stream snapshot helper can then be removed by the bundler.

The report measures an error guard, the RPC factory, and the HTTP factory with peers external or
included:

| Peer treatment | What the size includes                                               |
| -------------- | -------------------------------------------------------------------- |
| External       | Retained package code and peer imports; dependency code is excluded. |
| Included       | Retained package code and the peer code needed by that import.       |

These probes measure one retained package export. An application's contract Schemas, transport,
QueryClient, framework, and other imports change its final bundle. Compare reports from the same
probe and dependency versions before attributing a size change to the adapter.
