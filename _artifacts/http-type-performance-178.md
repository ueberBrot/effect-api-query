# HTTP type work — #178

Base: `c1662be32cc26149203cfecb7ed93863997e668c` (latest local spec/166 integration at measurement). Only `src/http/types.ts` changes compiler behavior. No workload, dependency or fixture changes.

## Reproduction and provenance

Frozen `vp install --frozen-lockfile`; Node 24.22.1, pnpm 12.15.0, macOS arm64. Effect 4.1.0; Query Core 5.105.0. TSRS: @effect/tsgo 0.67.3, engine 0.21.0-ts7.1.0-beta, language 7.1.0-beta, Microsoft revision 3e9236361fa9 (verified with actual `--version`). Minimum: TypeScript 5.9.3. Compare each engine only with itself.

Lockfile SHA256: `b3f47c05de7cf8ad9650fa0df285ae437445c99055c4b21f588fbc9f2b636364`. Workload scripts/measure-types.mts SHA256: `ca3f257b497eb23e748e54dc4e5ba36cb0fde1e55eb33c361fbb48f6fe3246e5`.

Run `TYPE_ADAPTERS=http PERFORMANCE_OUTPUT=<file> vp run type-baseline` sequentially on base and candidate. Each run builds the package, copies built public exports into a disposable consumer (no repository source imports), then compiles identical literal 50/250/1,000-operation contracts and contract/raw/scoped-configured consumers. Strict ES2022/Bundler/noEmit with skipLibCheck; unchanged options. Native packed-framework checks separately install the actual tarball.

One complete run per version was warmup (before.json / candidate3.json); two subsequent sample runs per version use fresh compiler processes. No overlapping build/pack or compiler-check task in these retained samples. Raw reports/logs are in `/tmp/effect-api-query-spec-166/178-{before,after}-sample{2,3}.{json,log}`. Reports include built-package hashes, exact dependencies, compiler identity, memory and separate check/total/wall times. Before sample 1 is clean base; later before samples have guidance edits only. Candidate reports correctly mark the worktree changed. Timings are observations, not statistical speedup evidence.

## Investigation

- Direct extraction from the group's endpoint property map increased instantiations slightly; discarded (candidate1.json).
- Replace distributive `Key extends keyof Value` client-member lookup with `Value[Key & keyof Value]`. Supported finite keys still resolve precisely; missing keys still resolve to never. This removes repeated membership conditionals without bypassing client overload analysis (candidate2.json).
- Extract an exposed Effect's service and success channels in one conditional, then include stream services from that success. This preserves the previous union of Effect services and stream services, including metadata-only overload services. Leave MethodSignatures, endpoint eligibility, requests, errors and builder overloads intact.

Existing compile-time fixtures are the public contract seam (including native React); existing expected-error cases remain unchanged. The performance workload is the deterministic acceptance seam; its base count is the red baseline and reduced count is the green result. No runtime implementation changes or internal-helper tests are needed for these type reductions.

## Instantiations

Both retained samples reproduce every count exactly. Contract-only controls are unchanged.

| Compiler | Operations | Consumer   |    Before |     After |
| -------- | ---------: | ---------- | --------: | --------: |
| current  |         50 | contract   |     9,143 |     9,143 |
| current  |         50 | raw        |   119,681 |   118,740 |
| current  |         50 | configured |   133,772 |   132,828 |
| current  |        250 | contract   |    33,543 |    33,543 |
| current  |        250 | raw        |   649,081 |   644,940 |
| current  |        250 | configured |   679,372 |   675,228 |
| current  |       1000 | contract   |   125,043 |   125,043 |
| current  |       1000 | raw        | 4,771,831 | 4,755,690 |
| current  |       1000 | configured | 4,862,872 | 4,846,728 |
| minimum  |         50 | contract   |     9,156 |     9,156 |
| minimum  |         50 | raw        |   117,350 |   116,409 |
| minimum  |         50 | configured |   131,428 |   130,484 |
| minimum  |        250 | contract   |    33,556 |    33,556 |
| minimum  |        250 | raw        |   640,750 |   636,609 |
| minimum  |        250 | configured |   671,028 |   666,884 |
| minimum  |       1000 | contract   |   125,056 |   125,056 |
| minimum  |       1000 | raw        | 4,741,000 | 4,724,859 |
| minimum  |       1000 | configured | 4,832,028 | 4,815,884 |

At 1,000 operations the reduction is 16,141 raw / 16,144 configured instantiations on each compiler (about 0.34% / 0.33% on TSRS). This is a small linear reduction, not elimination of the larger scaling cost. No type broadening or relaxed fixtures justify it.

## Environment-sensitive diagnostics

Ranges across the two retained samples; memory in MiB, check and wall time in milliseconds. These metrics are reported separately from deterministic counts; no timing or memory improvement claim.

| Compiler | 1,000-operation consumer | Memory before / after MiB | Check before / after ms | Wall before / after ms |
| --- | --- | --- | --- | --- |
| current | contract | 84.2–84.2 / 84.2–84.2 | 23.0–30.0 / 24.0–25.0 | 240.4–376.8 / 254.5–292.3 |
| current | raw | 146.7–149.4 / 146.8–148.7 | 294.0–560.0 / 315.0–345.0 | 512.1–928.9 / 571.7–582.3 |
| current | configured | 148.2–148.7 / 149.0–150.1 | 307.0–349.0 / 324.0–333.0 | 520.6–593.5 / 547.8–559.7 |
| minimum | contract | 247.4–247.9 / 247.7–247.8 | 200.0–210.0 / 210.0–220.0 | 798.3–870.9 / 883.8–938.9 |
| minimum | raw | 789.7–790.6 / 764.6–789.0 | 2930.0–3120.0 / 3630.0–4170.0 | 3562.9–3803.2 / 4417.2–4879.2 |
| minimum | configured | 775.0–775.5 / 776.1–787.2 | 3100.0–4300.0 / 3700.0–3720.0 | 3792.0–5028.0 / 4506.2–4526.5 |

## Scope and limits

All 18 workloads pass each retained run, including the 1,000-operation raw/configured consumers; no hidden TS2589 errors. Existing overload/custom-client/service/metadata, selection/initial-data, conditional input, stream and finite-path fixtures must pass both compilers before handoff. Final validation evidence is in the ticket result. Prepare-once/configure-once advice concerns runtime reuse and does not promise reduced hook checking or replace reactive option rebuilding. No accepted architecture decision changes; ADR0044 is unnecessary. Regression budgets and combined validation remain #180; parent Astra reviews remain separate. Fresh consumer-agent discovery and graphical editor/platform behavior are unverified by this task.
