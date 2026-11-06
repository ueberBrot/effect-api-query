# UX, example coverage, and dependency audit

Date: 2026-11-06. Baseline: `e09d5b6` (`0.6.0`). This is a source audit and a verified dependency-update draft, not a usability study or an exhaustive correctness review.

## Recommendation

Prioritize runnable demonstrations and a shorter first integration. The existing API already covers most of the relevant Query-adapter surface: typed options and keys, generic pagination, scoped policies, typed failures, bounded streams, explicit snapshots, and view-aware hydration. A new breaking API is not justified by the comparison alone.

The [competitor research](competitor-ux-research-2026-11-06.md) checks official sources for tRPC v11.25.0, published oRPC v2 beta.48, and ts-rest v3.52.1. oRPC v2 is still a beta; ts-rest's site announces the end of maintenance. Compare these adapters' client experience separately from their server, transport, OpenAPI, and authentication stacks.

## Findings and proposed work

| Priority | Finding | Concrete next change | Compatibility impact |
| --- | --- | --- | --- |
| High | New HTTP capabilities do not have runnable application demonstrations. | Add separate HTTP SSE/NDJSON pages, an ETag/metadata write flow, and a multipart upload flow with visible progress or pending state, failure, and cancellation where supported. Keep the first read/write page small. | Additive examples; no library break. |
| High | Several useful helpers are discoverable mainly in guides. | Use `configureUtils` in one application-owned setup; show typed declared-error handling, partial/view invalidation, publication deadlines, and a reconnect/gap-refresh flow in focused examples. | Additive examples; reuse existing APIs. |
| High, fixed in this draft | The Effect floor/current runtime selection omitted the recently added HTTP stream, metadata, sharing, and hydration-codec suites. Compiler coverage already included their public fixtures. | Expanded the packed consumer selection from 8 to 14 files; moved hydration-codec tests to package-root exports so they run against the published entry point. | Verification only; no runtime API change. |
| Medium | Rich decoded results retain native Query sharing semantics. Repeated equivalent Schema class values need an explicit sharing policy. | Add a runnable refetch/render-counter example using the existing schema-defined sharing recipe. Consider a helper only after measuring guards, equality cost, and consumer savings. | Example first; an optional helper could be additive. A default change needs a separate design decision. |
| Medium | Correct lifetime and SSR setup is spread across several modules and guides. | Provide a minimal owner/provider template and one SSR decision path: DTO, rich decoded value, infinite pages, or open-stream snapshot. Keep transport and disposal under application control. | Additive templates; preserve [ADR 0007](../docs/adr/0007-keep-the-core-factory-lifecycle-neutral.md). |
| Medium | The declared Effect range excludes the current 4.1 line and its fixes/features. | Review 4.1 separately after release-age eligibility, including packed types, native clients, cancellation, metadata, NDJSON, hydration, builds, and peer coordination. Do not widen support as a lockfile-only update. | Explicit peer-range/design change under [ADR 0033](../docs/adr/0033-bound-effect-support-to-a-patch-line.md). |
| Lower | Filter helpers are less discoverable than attached methods in competing APIs. | Evaluate an attached convenience only if a real consumer task shows repeated confusion. Preserve explicit canonical projections and view discrimination. | Could be additive; preserve [ADR 0028](../docs/adr/0028-bind-partial-filters-to-explicit-projections.md). |
| Lower | Non-React framework coverage consists of guides and packed TypeScript consumers. | Add one small native application per framework as demand warrants; avoid claiming component-compiler/runtime certification from type fixtures. | Additive validation. |

These priorities are judgments from the inspected source and documentation, not measured user-study results. This audit found a verification gap, not evidence of a shipped NDJSON defect.

Automatic network batching, inferred mutation invalidation, lifecycle ownership in the factories, and universal decoded equality would alter the package's scope or semantics. The comparison supplies no evidence that those changes would improve this adapter. See [ADR 0026](../docs/adr/0026-keep-rpc-transport-aggregation-in-the-application.md), the [public exports](../src/index.ts), and the [sharing guide](../apps/docs/src/content/docs/guides/share-decoded-values.md).

## Are the examples complete?

**The runnable applications do not demonstrate every supported feature.** Checked documentation snippets and runtime/compiler fixtures cover a broader surface than the two complete apps.

| Capability | Runnable evidence | Other evidence or missing demonstration |
| --- | --- | --- |
| RPC and buffered HTTP reads, writes, pages, conditional input, errors, cancellation | Both apps | [Vite HTTP panel](../examples/vite-react/src/components/sections/http-section.tsx), [Start HTTP route](../examples/tanstack-start/src/routes/http.tsx). |
| Accumulated RPC history, explicit retention, latest value | Both apps | [Vite diagnostics](../examples/vite-react/src/components/sections/diagnostics-section.tsx), [Start route](../examples/tanstack-start/src/routes/index.tsx). |
| Optimistic overlapping writes, owner retirement, allowlisted persistence | Vite React | [Write coordination](../examples/vite-react/src/lib/user-writes.ts), [owner cache](../examples/vite-react/src/lib/owner-cache.ts). |
| Request-local SSR, async codecs, infinite pages, stream snapshots | TanStack Start | [Snapshot registry](../examples/tanstack-start/src/lib/snapshot-preparation.ts), [SSR integration](../examples/tanstack-start/src/lib/query-ssr.ts). |
| HTTP SSE and decoded NDJSON | No application endpoint or screen | [HTTP stream tests](../tests/http-cached-views.test.ts), [NDJSON tests](../tests/http-ndjson-query.test.ts), [NDJSON fixture](../tests/types/docs-http-ndjson.ts). |
| HTTP status/headers/ETag and multipart uploads | No application endpoint or screen | [Metadata tests](../tests/http-metadata-options.test.ts), [multipart tests](../tests/http-multipart.test.ts), guide recipes. |
| Scoped configuration/interceptors, projected filters, prepared inputs, declared-error lookup | No dedicated application demonstration | [Configuration guide](../apps/docs/src/content/docs/guides/query-defaults.md), [filters](../apps/docs/src/content/docs/guides/cache-filters.md), [failure guide](../apps/docs/src/content/docs/guides/handle-failures.md), [prepared inputs](../apps/docs/src/content/docs/reference/performance.md). |
| Publication count/deadline, uncached consumption, cursor recovery | No application flow | [History guide](../apps/docs/src/content/docs/guides/choose-stream-history.md), [recovery tests](../tests/stream-recovery.test.ts). |
| Schema-defined rich-value sharing | No refetch/render demonstration | [Checked recipe](../tests/types/docs-structural-sharing.ts), [RPC tests](../tests/create-rpc-query-utils-structural-sharing.test.ts), [HTTP tests](../tests/http-structural-sharing.test.ts). |
| WebSocket transport | No selectable application transport | [Native socket consumer tests](../examples/server/tests/rpc-websocket-consumer.test.ts), [guide](../apps/docs/src/content/docs/guides/websocket-clients.md). |

The [shared HTTP contract](../examples/contracts/src/http-api.ts) declares buffered directory/diagnostic endpoints only. The [public examples page](../apps/docs/src/content/docs/examples.md) now makes the application-versus-recipe boundary explicit. It does not claim new screens were implemented.

## Dependency decisions

The unchanged [seven-day policy](../docs/adr/0017-quarantine-new-dependency-releases-for-seven-days.md) governs every resolved registry package. Exact pins, both lockfiles, lifecycle permissions, and intentional older compiler fixtures remain in place. The published peers remain `effect >=4.0.6 <4.1.0` and Query Core `>=5.104.4 <6`.

| Dependency group | Before | Selected eligible version |
| --- | --- | --- |
| Effect runtime, Node platform, Vitest integration | `4.0.7` | Retained `4.0.7`; no newer `4.0.x` release exists. |
| Effect TypeScript tooling | `0.57.0` | `0.63.0` |
| Query Core, React/Vue/Solid/Angular Query | `5.104.5` | `5.105.0` |
| Svelte Query | `6.3.5` | `6.3.6` |
| Angular fixture | `22.2.3` | `22.2.4` |
| Solid / Svelte fixtures | `1.9.17` / `5.57.2` | `1.9.18` / `5.57.3` |
| Astro / Starlight | `7.4.2` / `0.42.7` | `7.4.4` / `0.42.8` |
| Fallow | `3.36.0` | `3.37.0` |
| Ultracite | `8.0.0` | Retained `8.0.0`; 8.1 introduces 3,914 style diagnostics across 196 files and needs a separate migration. |
| Oxlint | `1.89.0` | Retained `1.89.0`; `1.90.0` requires checker `>=7.0.2005`, while Vite+ supplies `7.0.2004`. |

Registry metadata: [Effect](https://registry.npmjs.org/effect), [platform](https://registry.npmjs.org/@effect/platform-node), [Vitest integration](https://registry.npmjs.org/@effect/vitest), [Effect tooling](https://registry.npmjs.org/@effect/tsgo), [Query Core](https://registry.npmjs.org/@tanstack/query-core), [Oxlint 1.90.0](https://registry.npmjs.org/oxlint/1.90.0). The package manager checked the remaining selected packages against their publication metadata while resolving both lockfiles. The final workspace peer check reports no mismatches.

### Effect fixes and features that matter here

- Already installed in **4.0.7**: an RPC Scope shutdown hang after a stream decoding failure during socket disconnection; the SSE parser dropping a BOM-prefixed first event after an empty chunk; rejection of `.` and `..` path parameters; clearer undeclared-status diagnostics; improved HTTP client service inference; and multiple NDJSON content-type declarations. These are upstream transport/decoding behaviors, not newly implemented adapter code. [Official 4.0.7 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.7).
- **4.1.0** was published October 29 and is old enough, but is outside the declared range. It adds opt-in RFC 9457 Problem Details, RPC disconnection observation, transient HTTP predicates, and changes cookie-reference semantics. Problem Details deserves a future typed form/error example; its ready-client decoding may need no new adapter API. That last statement is a proposal to verify, not established compatibility. [Official 4.1.0 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.0).
- **4.1.2**, published November 2, is both outside the range and too young on November 6. Relevant fixes include cookie selection after `HttpApiClient` base-URL completion and malformed RPC headers producing a defect Exit rather than an empty HTTP 500. Eligibility begins seven days after each package's exact publication timestamp, not at midnight. [Official 4.1.2 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.2).
- **Effect tooling 0.63.0** brings diagnostic/quick-fix corrections, including a false `never` spread diagnostic fixed in 0.60.1, import-aware generated references, and additional Effect style suggestions. This updates development tooling without widening the runtime peer. [Official tooling changelog](https://github.com/Effect-TS/tsgo/blob/main/_packages/tsgo/CHANGELOG.md).

Query Core **5.105.0** has no Core changes in its changelog. Important later cancellation, infinite-page, and mutation-resume fixes are in 5.105.2/5.105.3; those were not yet age-eligible in this snapshot. Do not credit the selected update with those fixes. [Official Core changelog](https://github.com/TanStack/query/blob/main/packages/query-core/CHANGELOG.md).

Starlight **0.42.8** fixes autogenerated sidebar edge cases, missing production last-updated dates, and an error-formatting issue. [Official Starlight notes](https://github.com/withastro/starlight/releases/tag/%40astrojs%2Fstarlight%400.42.8). Fallow **3.37.0** includes analysis false-positive fixes and Git/hook hardening; these changes improve repository tooling rather than the published adapter. [Official Fallow notes](https://github.com/fallow-rs/fallow/releases/tag/v3.37.0).

## Verification

- Frozen workspace installation and final peer validation: passed; no peer mismatches.
- Native package build with declaration generation, publint, and Are the Types Wrong: passed using `vp pack` directly.
- Full runtime suite: **790 tests in 65 files passed**.
- Expanded packed Effect compatibility: **163 tests in 14 files per release**, plus public fixtures on TypeScript **7.0.2 and 5.9.3**, passed at **4.0.6 and 4.0.7**.
- Packed Vue, Solid, Svelte, and Angular consumers: passed on both compilers.
- Typed lint, type checking, and formatting: passed using the direct equivalent of the configured task.
- Strict Effect diagnostics: **0 errors, 0 warnings**, with one informational suggestion in an existing hydration fixture.
- Both Vite React and TanStack Start application builds: passed.
- Fallow dead-code, duplication, and health commands: passed.
- Documentation: **21 excerpt tests**, Astro diagnostics, **58 built pages**, and all internal links passed. Existing i18n/404 content warnings remain; application builds emit upstream `use client` bundling warnings.

On this host, Vite+-supervised package/type-tool invocations hit native `spawn EBUSY`; directly running the same builder/check commands passed. This is an environment/toolchain finding, not evidence of an adapter source error. Standard task invocations were attempted first. No configuration was weakened to obtain the direct results.

This audit ran compiler and runtime consumer processes. It did not run a fresh consuming agent, a competitor application, a new browser session, or comparative performance benchmarks. No branch, commit, PR, or release is created by this audit. The dependency and verification edits remain a local reviewable draft.
