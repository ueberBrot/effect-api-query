---
title: Performance and Bundling
description: Factory and key construction costs, measurement workloads, and adapter and application bundles.
---

## Construction

Each factory validates the full contract and freezes its branches before returning. It builds and freezes each leaf on first access. Larger contracts still cost more to validate, while apps that use few leaves avoid constructing the rest.

A payload-bearing key needs freshly encoded, frozen JSON. RPC constructs and encodes the payload. HTTP encodes each declared request part. Options also retain input and create a query function. To reuse input preparation, use `prepareInput`.

A custom RPC encoder replaces Schema encoding. Payload construction, JSON validation, copying, and freezing still run. Preserve every safe input value that distinguishes responses.

`configureUtils` copies policies and interceptor lists. It reuses frozen subtrees when they get no new settings. Shared policy still applies to descendants. An empty policy adds no configuration work, but an explicit undefined field or callback mode can change behavior. Configure once per owner and reuse across renders.

## Repeatable measurements

To measure factory construction, run the workload from the repository root.

```sh
vp run construction-baseline
```

It tests contracts with 1, 250, and 1,000 operations. Each size covers empty configuration, one leaf, all leaves, and three successive configurations. Each configuration sample applies 50 iterations to a built tree. The key and option cases use 1 or 100 payload records. Each workload uses 20 warmups and five samples.

Use the other workloads to measure compiler diagnostics, bundles, and stream publication.

```sh
vp run type-baseline
vp run bundle-baseline
vp run stream-baseline
```

The packed type workload runs at 50, 250, and 1,000 operations on Effect-enhanced TSRS 0.25.0 and TypeScript 5.9.3. It covers direct contract types, raw and configured utilities, default tag-keyed RPC clients, reusable policy maps, mixed contracts with root or path stream retention, and contract-derived hydration with and without overrides. The bundle workload compares consumers with included and external peers. The stream workload measures retention, batch size and deadlines, live values, cache writes, notifications, and cleanup.

To measure the cost of an SSE overload, run 1,000 buffered HTTP endpoints and one SSE endpoint. Compare the standard client with clients that have a specialized SSE overload, with and without a typed client error.

```sh
TYPE_ADAPTERS=http TYPE_COUNTS=1000 TYPE_HTTP_CLIENTS=sse,sse-overload,sse-overload-typed-error vp run type-baseline
```

`vp run sharing-baseline` compares native sharing, a manual recipe, `schemaStructuralSharing`, and disabled sharing. It measures 50 cache writes per sample across five samples. It uses 10 or 1,000 readings with all, some, or no values changed. It allocates inputs before timing. Measure decoding, transport, and rendering separately.

Compare the same operation counts, consumer, compiler, target, lockfile, and options. Run warmup separately and sample fresh compiler processes. Use instantiations to compare compiler work. Report memory, check time, and elapsed time separately.

Each workload prints JSON. Construction, type, bundle, and stream reports include version information and support `PERFORMANCE_OUTPUT` for writing the report to a file. Construction also records fingerprints of the configuration and workload script.

See the [stream workload](https://github.com/ueberBrot/effect-api-query/blob/main/tests/create-rpc-query-utils-stream-baseline.test.ts) and [transport workload](https://github.com/ueberBrot/effect-api-query/blob/main/examples/server/tests/rpc-transport-overhead.test.ts). Compare matching workload and dependency versions. Time and memory vary by machine.

### Regression budgets

The [bundle and compiler budgets](https://github.com/ueberBrot/effect-api-query/blob/main/scripts/performance/budgets.mts) set size and instantiation limits for the default workloads and the 1,001-operation SSE overload cases. Bundle limits differ by consumer and peer mode. Compiler limits differ by compiler, workload, operation count, and consumer.

Before changing a budget, run the default workloads with matching compilers, dependencies, contracts, and consumed leaves. Explain what accounts for the added cost. Timing and heap measurements are observations.

Stream write limits follow event counts or batch flushes. Observer notifications also include fetch and settlement. Deadline and coalescing counts can vary with scheduling. Separate deterministic tests cover deadlines, coalescing, and final flushes.

### 0.8.0 bundle reference

These byte counts use the packed release candidate, Effect `4.1.4`, Query Core `5.107.1`, and the pinned Rolldown build. Each pair gives minified and gzip bytes.

| Consumer | Peers | Native | Adapter | Adapter delta | Maximum delta |
| --- | --- | --: | --: | --: | --: |
| RPC | Included | 117,274 / 35,943 | 154,414 / 48,053 | 37,140 / 12,110 | 37,300 / 12,200 |
| RPC | External | 434 / 294 | 22,447 / 7,983 | 22,013 / 7,689 | 22,200 / 7,800 |
| HTTP | Included | 125,679 / 38,576 | 171,261 / 53,135 | 45,582 / 14,559 | 45,800 / 14,700 |
| HTTP | External | 558 / 338 | 28,355 / 9,702 | 27,797 / 9,364 | 28,000 / 9,500 |
| Streamed | Included | 126,082 / 38,919 | 154,416 / 48,044 | 28,334 / 9,125 | 28,500 / 9,300 |
| Streamed | External | 450 / 307 | 22,452 / 7,981 | 22,002 / 7,674 | 22,200 / 7,800 |
| Hydration | Included | 119,098 / 36,395 | 159,219 / 49,579 | 40,121 / 13,184 | 40,300 / 13,300 |
| Hydration | External | 332 / 233 | 24,862 / 8,802 | 24,530 / 8,569 | 24,700 / 8,700 |

All eight sizes match the integrated 0.8.0 source before documentation and example changes. The old ceilings came from an earlier API. The current ceilings use the measured sizes plus 90–218 bytes of headroom. The workload still checks that unused Reactivity bridge code stays out of these consumers.

### Bundle attribution limits

Module reports show retained bytes before final minification. They measure the adapter as one built module. Gzip deltas depend on other bundled modules.

The native examples measure successful reads, unbounded stream publication, and JSON hydration. Utility examples add key preparation, stream policies, error and cleanup handling, or codecs. Compare the resulting bundle sizes as costs for those capabilities. Rolldown builds both consumer variants.

## Adapter and application bundles

Effect and Query Core are peers. The package marks exports as free of side effects and annotates lazy cache wrappers for tree shaking. A bundler can remove unused factories and helpers when you import only what you use.

External peers stay outside an adapter-only bundle. App bundles also include contract Schemas, transport, QueryClient, framework, and other imports. Compare the same imports and versions when measuring the adapter.

## Reuse a stable input

Create the utility tree and shared `configureUtils` settings once per owner. Rebuild call-site options when reactive input changes.

Prepare a large input once when several builders reuse it.

```ts
import { prepareInput } from "@ueberbrot/effect-api-query";

const prepared = prepareInput(rpc.users.get, { id: 1 });
const key = rpc.users.get.queryKey({ input: prepared });
const options = rpc.users.get.queryOptions({
  input: prepared,
  staleTime: 30_000,
});
```

`prepareInput` runs construction, encoding, and copying once. For HTTP, pass decoded request parts. Reuse the handle with exact keys and ordinary, metadata, live, or streamed builders. Infinite key builders also accept it. Infinite mappers and mutations still take raw input. `InferInput` describes that raw input.

A handle belongs to the leaf that prepared it and works with its configured copies. Other leaves and trees reject it before execution, even with the same contract and prefix. It retains execution input while reachable. Use hydration codecs for data transfer.

Keep retained values unchanged, including nested mutable values. If parameters change, make new input and prepare it again. Inputless and mutation-only leaves have nothing to prepare.

Use the ordinary and prepared construction measurements to compare repeated builds. The prepared measurements exclude the cost of the first preparation. Each call still allocates its options and function.
