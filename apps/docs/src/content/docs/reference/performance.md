---
title: Performance and Bundling
description: Factory and key construction costs, measurement workloads, and adapter and application bundles.
---

## Construction

Factories build and freeze the complete RPC or HTTP utility tree when called. Each tree belongs to one ready client and cache owner. A larger contract increases factory work, even when the application uses only a few leaves.

Payload-bearing keys prepare a fresh immutable canonical payload. RPC preparation constructs and Schema-encodes the normalized payload. HTTP preparation encodes the declared request parts. Larger payloads require more preparation work. Executable query options also capture the request and create a fresh query function. Ordinary calls do not memoize payloads or option objects. Explicit prepared inputs can reuse input preparation.

A custom RPC key encoder replaces Schema encoding. Payload construction, JSON validation, canonical copying, and freezing still run. The encoder must preserve every input field that can change the result so cache identity remains correct.

`configureUtils` snapshots policy properties and interceptor lists when called. Sparse scoped settings reuse frozen subtrees that receive no new inherited settings; a shared policy or interceptor still applies across its descendants. Empty policy objects and interceptor lists add no configuration work. Callback mode settings and explicitly undefined policy properties remain meaningful across repeated calls. Configured copies retain cache identity and prepared-input ownership. Configure utilities once per owner and reuse them across renders.

## Repeatable measurements

The optional construction workload measures repository sources:

```sh
vp run construction-baseline
```

The construction workload covers RPC and HTTP factories with 1, 250, and 1,000 operations. At each size it measures empty configuration, one scoped leaf, all scoped leaves, and three successive configurations (sparse, shared root policy, sparse). Each configuration sample applies 50 iterations to an already constructed tree, excluding contract and client acquisition. Key and ordinary/prepared option workloads use one operation with 1 or 100 payload records. All workloads use 20 warmup iterations and five samples.

Additional workloads report compiler diagnostics, consumer bundle sizes, and stream publication costs:

```sh
vp run type-baseline
vp run bundle-baseline
vp run stream-baseline
```

Type measurements compare contracts alone, raw utilities, and scoped configuration at 50, 250, and 1,000 operations on both supported compilers. Bundle measurements compare RPC, HTTP, stream and hydration consumers with native options or utilities, with peers included and external. Both variants retain the same exported contract and ready-client boundary. Stream measurements include bounded and unbounded histories, count and deadline publication, live values, cache writes, observer notifications, and cleanup.

Compare compiler runs with identical operation counts, contract/raw/configured consumers, engine, language target, dependency lockfile, and compiler options. The development compiler is Effect-enhanced TSRS; the minimum consumer compiler is TypeScript 5.9.3. Compare each compiler with itself. Save a separate warmup run, then repeat samples in fresh compiler processes. Instantiation counts measure compiler work. Report memory, check time, and wall time separately because they vary with the environment. A compiler upgrade does not establish an adapter improvement.

Each workload prints JSON with its dependency and runtime versions. Set `PERFORMANCE_OUTPUT` to save the same report to a file. Construction reports also fingerprint the configuration source and workload script. Compare matching workloads and versions before attributing a change to the adapter.

The [stream workload](https://github.com/ueberBrot/effect-api-query/blob/main/tests/create-rpc-query-utils-stream-baseline.test.ts) and [transport workload](https://github.com/ueberBrot/effect-api-query/blob/main/examples/server/tests/rpc-transport-overhead.test.ts) measure publication and transport costs. Results are comparable only for the same workload and dependency versions. Elapsed time and memory depend on the machine.

### Regression budgets

The default bundle and compiler workloads enforce the ceilings in `scripts/performance/budgets.mts`. Bundle ceilings cover the added minified and gzip bytes for each consumer and peer mode. Compiler ceilings cover instantiations separately for each compiler, adapter, operation count and contract/raw/configured consumer. They allow about 10% above the spec #166 combined baseline to catch substantial regressions while allowing small implementation changes. Custom operation counts outside that table have no compiler budget.

Run the complete default workloads when changing these ceilings. Keep compiler engine, language target, dependencies, contracts and consumed leaves equal across comparisons. Record why the added capability warrants the cost before raising a ceiling. Timing and heap snapshots are observations, never pass/fail limits.

Stream budgets bound manual cache writes by the emission count, or by first-value plus batch flushes for count batching. Observer notifications allow the fetch and settlement transitions as well. Deadline and coalescing workloads use the emission bound because event-loop scheduling changes their write counts. Deterministic public tests separately check exact coalesced publications, fixed deadlines and final flushing. A fast local source producing two coalesced writes does not promise two writes on every machine.

### Bundle attribution limits

Reports list retained modules and their rendered bytes before final minification. The package is already one built module, so those bytes cannot identify the cost of an individual original source file. Gzip deltas also include compression interactions with peers; they are not additive module sizes.

The native consumers model successful reads and ordered unbounded stream publication. They do not reproduce the adapter's complete Cause, cleanup, key preparation or view-policy guarantees. Native hydration handles JSON query data; the utility variant adds Schema codec registration. These deltas measure the cost of retained capabilities, not equivalent implementations or runtime speedups. The selected compiler is reported as build provenance; Rolldown performs the JavaScript consumer build.

## Adapter and application bundles

The package marks its exports as free of side effects and keeps Effect and Query Core as peers. An application can import one factory or an error guard from the package root. Unused factories and the stream snapshot helper can then be removed by the bundler.

An adapter-only bundle with external peers excludes dependency code. The application's contract Schemas, transport, QueryClient, framework, and other imports contribute to the final bundle. Attributing a size change to the adapter requires a comparison with the same imports and dependency versions.

## Reuse a stable input

Create the utility tree and apply shared `configureUtils` policies once per client/cache owner. Reuse those utilities across renders; rebuild call-site options when reactive input changes. The compiler still checks literal contracts and native hook inference.

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
