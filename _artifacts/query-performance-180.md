# Combined query performance evidence (#180)

Measured the combined spec166 exports after integrating #179 follow-up `93e5766` and architecture fixes `ab0214b`. The measurement revision is `d1078edf93579405eb3686381bc2949e77c389ce` with a dirty working tree containing the bounded #180 pure-wrapper change and guidance updates. The built JavaScript/declaration SHA256 below fingerprints the actual measured artifact; the final ticket commit retains those sources.

## Provenance

- Package: `0.6.1`; Node `v24.22.1`, `darwin/arm64`.
- Bundler: Rolldown `1.2.15` via `@voidzero-dev/vite-plus-core@1.4.0`, imported as `vite/rolldown`.
- Peers: Effect `4.1.0`, Query Core `5.105.0`.
- Current compiler: `@effect/tsgo@0.67.3`, TSRS `0.21.0-ts7.1.0-beta`, TypeScript `7.1.0-beta`, Microsoft revision `3e9236361fa9`. Minimum consumer/compiler API: TypeScript `5.9.3`. Astro keeps `6.0.3`.
- Lockfile SHA256: `b3f47c05de7cf8ad9650fa0df285ae437445c99055c4b21f588fbc9f2b636364`.
- Built index.mjs + index.d.mts SHA256: `1f7fc8cdb30f810a90e71e058f44f7bcbcda3db8759839933a6bfe745b3ee0af`.

## Matched consumer bundles

Both variants export the same contract and accept a ready client. Native and generated options share the QueryClient boundary. Successful buffered reads, ordered unbounded stream publication and JSON hydration define the comparison. Native code omits adapter key preparation, complete failure/cleanup semantics and hydration codec registration. Deltas therefore measure retained capabilities; the baseline is not a replacement implementation. The optimization comparison below uses identical native/generated source, dependency versions, bundler options and language target before and after the five pure annotations.

| Consumer | Peers | Before delta, minified/gzip bytes | After delta, minified/gzip bytes | Saved minified/gzip bytes |
| --- | --- | --- | --- | --- |
| rpc | included | 33870 / 11007 | 32506 / 10699 | 1364 / 308 |
| rpc | external | 18348 / 6450 | 17548 / 6270 | 800 / 180 |
| http | included | 41342 / 13165 | 39978 / 12829 | 1364 / 336 |
| http | external | 23737 / 7957 | 22937 / 7776 | 800 / 181 |
| streamed | included | 25252 / 8075 | 23888 / 7767 | 1364 / 308 |
| streamed | external | 18337 / 6434 | 17537 / 6255 | 800 / 179 |
| hydration | included | 35953 / 11691 | 34589 / 11379 | 1364 / 312 |
| hydration | external | 19858 / 6990 | 19058 / 6822 | 800 / 168 |

## Retained code and decision

Rolldown reports retained module IDs and rendered byte counts before final minification. The packed adapter is one module, so attribution cannot allocate exact minified bytes to original source files. Inspecting the rendered code identified unused Effect/cache wrapper bodies and their error diagnostic in every factory consumer. `Effect.fnUntraced` in the pinned Effect source only builds a lazy function and defines its own length; it does not run the supplied generator. Five `@__PURE__` call annotations let unused bodies disappear. The cache-operation diagnostic marker is absent afterward; this alone does not prove every service allocation disappears. Owner/descriptor/sharing diagnostic markers were absent in these consumers before the change.

The RPC minified ceiling 33500 fails on the original 33870-byte delta and passes on the reduced 32506-byte delta. Other bundle ceilings retain roughly 10% headroom from the combined baseline. Compiler ceilings use the same 10% review threshold, separately for each pinned engine/workload. This is a maintenance policy, not measured compiler variability. Smaller increases still require review. Budgets never gate elapsed time.

Preserve root entry points, sideEffects=false, eager frozen construction, semantic keys, application-owned clients and framework neutrality. No evidence warrants changing those decisions (ADRs 0007, 0009, 0021 and 0029). This reduction changes bundler reachability of unused lazy wrappers only; used Effect/cache operations remain covered by public native-cache tests and packed consumers.

## Compiler work

One separate warmup, then three fresh-process samples of each unchanged contract/raw/configured workload. Every sample uses the same contracts, consumed leaves, flags and compiler version. Validation/browser processes could run concurrently; elapsed time and memory are retained in raw reports but support no gain claim. Compare instantiations within one compiler, never TypeScript 7.1 against 5.9. The table lists all observed sample counts.

| Compiler | Adapter / operations / consumer | Instantiations in three samples |
| -------- | ------------------------------- | ------------------------------- |
| current  | rpc / 50 / contract             | 51174 / 51174 / 51174           |
| current  | rpc / 50 / raw                  | 44446 / 44446 / 44446           |
| current  | rpc / 50 / configured           | 59929 / 59929 / 59929           |
| current  | rpc / 250 / contract            | 246574 / 246574 / 246574        |
| current  | rpc / 250 / raw                 | 176846 / 176846 / 176846        |
| current  | rpc / 250 / configured          | 215529 / 215529 / 215529        |
| current  | rpc / 1000 / contract           | 979324 / 979324 / 979324        |
| current  | rpc / 1000 / raw                | 673346 / 673346 / 673346        |
| current  | rpc / 1000 / configured         | 799029 / 799029 / 799029        |
| current  | http / 50 / contract            | 9143 / 9143 / 9143              |
| current  | http / 50 / raw                 | 118740 / 118740 / 118740        |
| current  | http / 50 / configured          | 132828 / 132828 / 132828        |
| current  | http / 250 / contract           | 33543 / 33543 / 33543           |
| current  | http / 250 / raw                | 644940 / 644940 / 644940        |
| current  | http / 250 / configured         | 675228 / 675228 / 675228        |
| current  | http / 1000 / contract          | 125043 / 125043 / 125043        |
| current  | http / 1000 / raw               | 4755690 / 4755690 / 4755690     |
| current  | http / 1000 / configured        | 4846728 / 4846728 / 4846728     |
| minimum  | rpc / 50 / contract             | 51174 / 51174 / 51174           |
| minimum  | rpc / 50 / raw                  | 44310 / 44310 / 44310           |
| minimum  | rpc / 50 / configured           | 59777 / 59777 / 59777           |
| minimum  | rpc / 250 / contract            | 246574 / 246574 / 246574        |
| minimum  | rpc / 250 / raw                 | 176710 / 176710 / 176710        |
| minimum  | rpc / 250 / configured          | 215377 / 215377 / 215377        |
| minimum  | rpc / 1000 / contract           | 979324 / 979324 / 979324        |
| minimum  | rpc / 1000 / raw                | 673210 / 673210 / 673210        |
| minimum  | rpc / 1000 / configured         | 798877 / 798877 / 798877        |
| minimum  | http / 50 / contract            | 9156 / 9156 / 9156              |
| minimum  | http / 50 / raw                 | 116409 / 116409 / 116409        |
| minimum  | http / 50 / configured          | 130484 / 130484 / 130484        |
| minimum  | http / 250 / contract           | 33556 / 33556 / 33556           |
| minimum  | http / 250 / raw                | 636609 / 636609 / 636609        |
| minimum  | http / 250 / configured         | 666884 / 666884 / 666884        |
| minimum  | http / 1000 / contract          | 125056 / 125056 / 125056        |
| minimum  | http / 1000 / raw               | 4724859 / 4724859 / 4724859     |
| minimum  | http / 1000 / configured        | 4815884 / 4815884 / 4815884     |

## Publication work

Each workload uses one warmup and three samples, the same in-process decoded RPC source, a fresh native cache, one disabled native observer and streamBufferSize=1. All source emissions and finalizers must complete with correct retention/final data. Count batching has an exact first-value-plus-flush bound. Deadline/coalescing write counts depend on scheduling, so their budget is the emission count; deterministic public fake-clock tests separately own fixed-deadline and exact coalescing assertions.

| Emissions | View | Manual cache writes in three samples | Retained values |
| --- | --- | --- | --- |
| 1000 | unbounded | 1000 / 1000 / 1000 | 1000 |
| 1000 | bounded-32 | 1000 / 1000 / 1000 | 32 |
| 1000 | batch-32 | 33 / 33 / 33 | 1000 |
| 1000 | batch-deadline | 33 / 33 / 33 | 1000 |
| 1000 | live | 1000 / 1000 / 1000 | 1 |
| 1000 | live-coalesced | 2 / 2 / 2 | 1 |
| 10000 | unbounded | 10000 / 10000 / 10000 | 10000 |
| 10000 | bounded-32 | 10000 / 10000 / 10000 | 32 |
| 10000 | batch-32 | 314 / 314 / 314 | 10000 |
| 10000 | batch-deadline | 314 / 314 / 314 | 10000 |
| 10000 | live | 10000 / 10000 / 10000 | 1 |
| 10000 | live-coalesced | 2 / 2 / 2 | 1 |

## Reproduce

Build with `vp run pack`, then run the complete default `bundle-baseline`, `type-baseline` and `stream-baseline` tasks. Set `PERFORMANCE_OUTPUT` to save each JSON report. Save a separate type warmup and three samples. `scripts/performance/budgets.mts` contains the reviewed ceilings; custom operation counts outside that table are unbudgeted. The scripts exit nonzero on exceeded budgets or invalid workload results.

Raw reports, the rejected pre-reduction budget, the source patch and full validation logs are retained in `/tmp/effect-api-query-spec-166/180-*`. Durable Fallow classifications are in `query-fallow-180.md`. Final CI, GUI/platform evidence and independent review are separate from these measurements. No publication or release version is selected.
