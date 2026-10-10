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
Larger payloads increase this work. Option builders also capture the request and create a fresh
query function. Repeated calls do not memoize payloads or option objects.

A custom RPC key encoder replaces Schema encoding. Payload construction, JSON validation,
canonical copying, and freezing still run. Choose an encoder for correct semantic identity;
it must preserve every input field that can change the result.

## Repeatable measurements

Maintainers can save a report while verifying the packed package:

```sh
EFFECT_API_QUERY_BASELINE=.artifacts/packed-baseline.json vp run packed-package
```

The report identifies the exact archive, runtime, peers, compiler versions, and source hashes.
Construction measurements use one or 250 operations and inputs containing one or 100 records.
Each stage reports five samples after warm-up, with factory construction separate from key and
option construction. RPC payload construction and Schema encoding also have separate samples;
the custom-encoder key measurement still includes the package's normal preparation.

Compiler reports separate the public contract, 250 RPC operations, and 250 HTTP endpoints under
both supported consumer compilers. A cold compiler process starts without an incremental build
file, then an unchanged incremental process reuses it. This does not reset operating-system caches.
Type and instantiation counts help compare declaration changes when the inputs and versions match.
Local elapsed time and memory measurements are observations, not performance guarantees or
universal regression thresholds.

## Adapter and application bundles

The package marks its exports as free of side effects and keeps Effect and Query Core as peers.
An application can import one factory or an error guard from the package root. Unused factories
and the stream snapshot helper can then be removed by the bundler.

The report builds an error-guard import, an RPC-factory import, and an HTTP-factory import with
Vite's Oxc minifier and an ES2022 target. Each probe has two sizes:

| Peer treatment | What the size includes                                               |
| -------------- | -------------------------------------------------------------------- |
| External       | Retained package code and peer imports; dependency code is excluded. |
| Included       | Retained package code and the peer code needed by that import.       |

Sizes include JavaScript bytes and gzip bytes at compression level nine. An error guard can
eliminate all peer code in the included probe, while an external probe retains bare peer imports
whose side effects the bundler cannot inspect. The included size can therefore be smaller for
that probe.

These probes measure one retained package export. An application's contract Schemas, transport,
QueryClient, framework, and other imports change its final bundle. Compare reports from the same
probe and dependency versions before attributing a size change to the adapter.
