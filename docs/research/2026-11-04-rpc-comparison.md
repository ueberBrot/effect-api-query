# RPC adapter comparison and dependency options

Research date: **2026-11-04, 10:43–10:52 Europe/Berlin (09:43–09:52 UTC)**. Repository revision: `604d8204e12861edc70d5996a873ff3d26919262`, package `0.5.0`. This is a research record, not a compatibility certification or implementation plan accepted by the project.

## Findings

The comparison boundary is the **Query adapter**, specifically `@orpc/tanstack-query`, tRPC's TanStack integration and equivalent contract-to-Query adapters. Effect owns RPC, HTTP, schemas, transports, server behavior and runtime services. Missing adapter convenience and upstream dependency benefits are separate categories below; infrastructure features are not missing responsibilities of this package.

The package already covers the main TanStack adapter features offered by oRPC v2 beta: typed ordinary, infinite, accumulated-stream and live options; generated keys; conditional queries; shared configuration; execution interceptors; and hydration support. Its useful remaining opportunities concern convenience and a few explicitly omitted HTTP shapes, rather than a missing RPC framework.

The best immediate dependency candidate is **Effect 4.0.7**, coordinated with the Effect development/platform packages. It clears the seven-day quarantine and fixes relevant shutdown, streaming, HTTP and retention problems. **Query Core 5.105.0** is also eligible, but its release notes report no Core changes. The more consequential Query fixes are in **5.105.1–5.105.3**, which are not yet eligible. The current Query peer already admits those versions; no wider peer range is needed. These conclusions follow from the registry timestamps and versioned changes below.

Avoid forcing every consumer onto a newer Effect version solely to obtain optional improvements. Supporting both `4.0.6` and `4.0.7` would require compatibility checks and an intentional revision of the exact-peer decision. Neither stable Effect version numbers nor successful tests establish stability of the upstream RPC and HTTP API modules.

## Evidence and version boundaries

I read `AGENTS.md`, the [domain guide](../agents/domain.md), [glossary](../../GLOSSARY.md), and the relevant ADRs before exploring implementation. Sources were official documentation, npm registry packuments, published source archives, tagged upstream source, and official release records. No GitHub issue pages were read. Release notes sometimes link issues; those links were not followed.

The task's manifest baseline is correct: [package metadata](../../package.json), [catalog](../../pnpm-workspace.yaml), and [lockfile](../../pnpm-lock.yaml) specify Effect `4.0.6`, tested Query Core `5.104.5`, and the Query peer `>=5.104.4 <6`. At research time, installed Effect, platform-node and Effect Vitest were `4.0.4`; Query Core and React Query were `5.104.2`. The follow-up documentation work restored the declared installation with `vp install --frozen-lockfile`, without manifest or lockfile changes. Documentation, package and skill checks against that installation do **not** certify an upgrade or a wider peer range.

### Current registry state

Versions and absolute publication times below came from registry JSON, not search snippets or relative “days ago” labels. “Stable” means a non-prerelease version on `latest`; it does not imply that every exported API is stable.

| Package family | Verified stable `latest` | Separate prerelease state | Latest version old enough for this repository |
| --- | --- | --- | --- |
| `effect` | `4.1.2`, published Nov 2, 04:27:38.068 UTC | `beta` is `4.0.0-beta.107`; `rc` is `4.0.0-rc.118`; neither is current stable | `4.0.7` |
| `@effect/platform-node`, `@effect/vitest` | Both `4.1.2`, published Nov 2 | Separate beta/RC tags also remain | Both `4.0.7` |
| `@tanstack/query-core`, `@tanstack/react-query` | Both `5.105.3`, published Nov 2 | Historical alpha/beta/RC tags do not supersede `latest` | Both `5.105.0` |
| `@orpc/server`, `@orpc/client`, `@orpc/tanstack-query` | All `1.16.1`, published Oct 22 | **`2.0.0-beta.48`**, published Nov 1, is the v2 comparison target, not a stable v2 release | Stable `1.16.1`; v2 beta `2.0.0-beta.47` |
| `@trpc/server`, `@trpc/client`, `@trpc/tanstack-react-query` | All `11.24.0`, published Nov 3 | Canary `11.24.1-canary.3.0277f21cd` is separate; some APIs within stable v11 are explicitly `unstable_` | Stable `11.19.0` |
| `@ts-rest/core`, `@ts-rest/react-query` | Both `3.52.1`, published Mar 4, 2025 | `rc` remains `3.53.0-rc.1`; do not report it as stable | Stable `3.52.1` |
| `openapi-react-query` | `0.5.4`, published Feb 11, 2026 | No separate current prerelease tag | `0.5.4` |

Registry sources: [Effect](https://registry.npmjs.org/effect), [platform-node](https://registry.npmjs.org/@effect%2fplatform-node), [Effect Vitest](https://registry.npmjs.org/@effect%2fvitest), [Query Core](https://registry.npmjs.org/@tanstack%2fquery-core), [React Query](https://registry.npmjs.org/@tanstack%2freact-query), [oRPC server](https://registry.npmjs.org/@orpc%2fserver), [oRPC client](https://registry.npmjs.org/@orpc%2fclient), [oRPC Query adapter](https://registry.npmjs.org/@orpc%2ftanstack-query), [tRPC server](https://registry.npmjs.org/@trpc%2fserver), [tRPC client](https://registry.npmjs.org/@trpc%2fclient), [tRPC Query adapter](https://registry.npmjs.org/@trpc%2ftanstack-react-query), [ts-rest core](https://registry.npmjs.org/@ts-rest%2fcore), [ts-rest Query adapter](https://registry.npmjs.org/@ts-rest%2freact-query), [OpenAPI Query adapter](https://registry.npmjs.org/openapi-react-query).

The fresh registry and current repository release records agree with the task date. An older official [`effect-smol` releases page](https://github.com/Effect-TS/effect-smol/releases) still surfaced July beta releases during discovery. It is not evidence that Effect 4 is currently beta. Registry metadata points to `Effect-TS/effect`; the specific [4.0.7](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.7) and [4.1.2](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.2) release records are non-prereleases. oRPC's [v1 migration guide](https://orpc.dev/docs/migrations/from-v1) instructs installing `@beta`, consistent with its [beta.48 prerelease record](https://github.com/middleapi/orpc/releases/tag/v2.0.0-beta.48).

### Seven-day eligibility

At the start of verification, the cutoff was **2026-10-28 09:43:41 UTC**. Eligibility is publication time plus 10,080 minutes, not a calendar-date comparison. [ADR 0017](../adr/0017-quarantine-new-dependency-releases-for-seven-days.md) forbids bypasses and missing-time exceptions.

| Package/version | npm publication, UTC | Eligible from, UTC | Status on Nov 4 at verification |
| --- | --- | --- | --- |
| Effect `4.0.7` | Oct 28, 03:36:20.753 | Nov 4, 03:36:20.753 | Eligible |
| Effect `4.1.0` | Oct 29, 04:09:37.471 | Nov 5, 04:09:37.471 | Quarantined |
| Effect `4.1.1` | Oct 30, 21:53:39.762 | Nov 6, 21:53:39.762 | Quarantined |
| Effect `4.1.2` | Nov 2, 04:27:38.068 | Nov 9, 04:27:38.068 | Quarantined |
| Query Core `5.105.0` | Oct 26, 09:31:24.687 | Nov 2, 09:31:24.687 | Eligible |
| Query Core `5.105.1` | Nov 1, 10:08:51.288 | Nov 8, 10:08:51.288 | Quarantined |
| Query Core `5.105.2` | Nov 2, 13:56:45.080 | Nov 9, 13:56:45.080 | Quarantined |
| Query Core `5.105.3` | Nov 2, 20:39:28.671 | Nov 9, 20:39:28.671 | Quarantined |

Sources: [Effect publication ledger](https://registry.npmjs.org/effect), [Query Core publication ledger](https://registry.npmjs.org/@tanstack%2fquery-core). Platform-node, Effect Vitest and platform-node-shared `4.0.7` were published earlier on Oct 28 and are also eligible. Platform-node `4.0.7` requires Effect `^4.0.7`, platform-node-shared `^4.0.7` and Undici `^8.12.2`; Undici `8.12.2` was published Oct 15. This checks relevant direct requirements, not an entire newly resolved transitive graph: a future install must still satisfy the strict policy for every resolved package. [Platform metadata](https://registry.npmjs.org/@effect%2fplatform-node), [shared platform metadata](https://registry.npmjs.org/@effect%2fplatform-node-shared), [Undici metadata](https://registry.npmjs.org/undici).

For a future comparison harness, beta.48 and tRPC 11.24.0 can be researched now but cannot be installed under this repository's current age policy yet. The oRPC Query beta.48 package becomes eligible Nov 8 at 13:46:51.506 UTC; the tRPC Query 11.24.0 package on Nov 10 at 22:54:55.128 UTC. Their package families have different publication timestamps; check the entire selected family rather than one tag.

## Existing adapter functionality

The baseline below is implementation-backed; it should prevent duplicate feature proposals. oRPC behavior was cross-checked against its [beta.48 Query documentation source](https://github.com/middleapi/orpc/blob/v2.0.0-beta.48/apps/content/docs/integrations/tanstack-query.mdx) and [versioned adapter source](https://github.com/middleapi/orpc/tree/v2.0.0-beta.48/packages/tanstack-query/src). tRPC's reference is its [v11 Query integration](https://trpc.io/docs/client/tanstack-react-query/usage) and [v11.24.0 source](https://github.com/trpc/trpc/tree/v11.24.0/packages/tanstack-react-query/src).

| Concern | What `0.5.0` already supplies | Comparison and actual remaining gap |
| --- | --- | --- |
| Queries, mutations, pagination | Typed options and DataTagged exact keys; arbitrary page-parameter-to-input mapper; native selection and initial-data overloads | Fundamental oRPC/tRPC adapter capability is present. No new pagination abstraction is needed. [RPC builders](../../apps/docs/src/content/docs/reference/generated-builders.md), [HTTP builders](../../apps/docs/src/content/docs/reference/http-builders.md). |
| Cache filters and namespacing | Required key prefix, separate HTTP/RPC roots, leaf view prefixes, typed partial projections, branch view filters | oRPC has `key({ type, input })`; tRPC has path/query filters. Here the equivalent capability is split across explicit helpers. Constructor defaults and custom encoders make naive partial-input inference unsafe. [Filters](../../src/core/query-filter.ts), [branch filters](../../src/core/branch-filter.ts), [ADR 0028](../adr/0028-bind-partial-filters-to-explicit-projections.md). |
| Streams | Accumulated and live queries, reset/append/replace behavior, explicit retention, count/deadline publication, iterator cleanup | Both oRPC cached views already exist. Publication batches here group cache writes, not network requests. [Stream implementation](../../src/core/streamed-query.ts), [publication](../../src/core/stream-publication.ts). |
| Subscriptions and recovery | Native `consumeEvents` with sequential callbacks; `recoverStream` with cursors, retry delays, state/gap/replay-expiry hooks | tRPC also has a React subscription hook. This package lacks that framework-owned hook, but event consumption and recovery are present. [Consumption](../../src/core/consume-events.ts), [recovery](../../src/core/stream-recovery.ts). |
| Shared policies and interceptors | `configureUtils` for tree, branch and leaf; scoped settings; explicit mutation callback composition; ordered execution interceptors | oRPC v2 defaults/interceptors are not missing. Contract annotation loading and a generic plugin lifecycle are absent. [Configuration](../../src/core/configure-utils.ts), [interceptors](../../src/core/interceptor.ts), [ADR 0032](../adr/0032-configure-utility-trees-and-require-stream-retention.md). |
| Errors | Complete Cause-preserving wrappers, literal operation identity and `findDeclaredError` for one tagged failure | Comparable declared-error ergonomics exist. Compound Causes deliberately remain compound; a universal flattened error union would lose meaning. [Lookup](../../src/core/declared-error.ts), [ADR 0005](../adr/0005-preserve-the-cause-in-one-error-wrapper.md). |
| SSR and hydration | Per-view codecs, an effectful multi-codec registry, explicit page-parameter codecs, and `fetchStreamSnapshot` that waits for local cleanup | Rich hydration and open-stream SSR are present. oRPC offers less configuration through global serializer defaults and an SSR plugin; this package has no serializable prefetch reference. [Hydration](../../src/core/hydration.ts), [snapshot guide](../../apps/docs/src/content/docs/guides/stream-snapshots.md). |
| Request options | RPC headers and context; stream buffer controls; query abort forwarding; caller-owned runner and clients | Do not call per-request metadata or cancellation missing. Identity-changing context must be reflected in application cache ownership/prefixes. [RPC options](../../src/rpc/types.ts), [execution](../../src/rpc/operation.ts). |
| HTTP uploads and metadata | Buffered multipart mutations; buffered status/header metadata view; preserved decoded header wrappers; SSE views | Status-aware HTTP consumption and uploads exist. NDJSON, streaming uploads, upgrades and raw byte-stream endpoints are omitted. [Request classifier](../../src/http/request.ts), [metadata behavior](../../apps/docs/src/content/docs/reference/http-builders.md). |
| Frameworks and efficiency | Core-shaped options, five framework consumer fixtures, immutable contract-analysis reuse and explicit prepared inputs | React/Vue/Solid/Svelte/Angular are not absent. Full application/runtime certification differs from type fixtures. Eager whole-tree construction remains a measurable design choice. [Compatibility](../../apps/docs/src/content/docs/reference/compatibility-and-limits.md), [prepared input](../../src/core/prepared-input.ts), [performance guide](../../apps/docs/src/content/docs/reference/performance.md). |

Two other adapters help bound scope. [ts-rest v5](https://ts-rest.com/client/react-query-v5) offers contract-shaped hooks, a typed QueryClient facade, and HTTP `{ status, body, headers }` results/errors. Its HTTP envelope is a different public representation, not evidence that this package lacks HTTP contracts or metadata. [openapi-react-query](https://openapi-ts.dev/openapi-react-query/) consumes generated OpenAPI types through openapi-fetch. That is a useful external-client path, already covered by this repository's [external HTTP client reference](../../apps/docs/src/content/docs/reference/external-http-clients.md); it does not require replacing decoded Effect clients.

## What dependency updates would buy

### Effect 4.0.7: eligible and relevant

These are upstream changes between the declared `4.0.6` baseline and the eligible patch. Benefits depend on the application's transport and operators; they are not newly implemented adapter features.

| Change | Relevance and validation target |
| --- | --- |
| A streamed chunk decode failure concurrent with a disconnected socket no longer prevents RpcClient Scope closure | Directly relevant to ready-client disposal and snapshot cleanup. Reproduce decode failure plus disconnect and assert settlement. [Fix](https://github.com/Effect-TS/effect/commit/58f164f8aa11a89640dce9c2ba44469c86b92b0b). |
| JSON-RPC batch stream chunks preserve order; synchronous handler throws respect request-level defect isolation | Relevant when applications select these RPC modes. Keep transport aggregation application-owned; test one failing and one successful concurrent call. [Batch ordering](https://github.com/Effect-TS/effect/commit/c05355cf42b95fb27575bb39957fa1ce11eb8fa6), [defect isolation](https://github.com/Effect-TS/effect/commit/f6df1aa987c4eeda8887e24bf106308ed5dad949). |
| `Stream.grouped`/`rechunk` retain buffered elements on failure; an SSE BOM edge case no longer loses the first event | Relevant to adapter/native-stream boundaries. Test emitted values followed by failure, including recovery and final Cause. [Stream fix](https://github.com/Effect-TS/effect/commit/3c3c79b17ba321120c02d3eaf3baade1d4d38000), [SSE fix](https://github.com/Effect-TS/effect/commit/a6174d59f7d46ec32f97f7d8a0312051494742c0). |
| `Effect.fn` tracing frames no longer retain call arguments; duplicate interruption reasons are fixed | Relevant to long-lived application fibers and preserved Causes. No adapter heap or latency improvement was measured. [Retention fix](https://github.com/Effect-TS/effect/commit/f4b237e0938c11472c4e4c45905f5e31018eb4c1), [interruption fix](https://github.com/Effect-TS/effect/commit/8e257e73250dda070954448f13bbdcf6124a80c9). |
| HttpApiClient rejects `.`/`..` path parameters; HttpClientError inspection/JSON exposes less request data | Improves upstream request safety and diagnostics. Full request objects remain accessible; this does not sanitize the adapter's complete Cause or supply an SSR error policy. [Path fix](https://github.com/Effect-TS/effect/commit/938cecb109ac92ca7ba74a1e2f9af7ba63f28135), [inspection change](https://github.com/Effect-TS/effect/commit/4d24a11217edda68e8c4c72cdc1cff025afa19d6). |
| HttpApiClient service inference is corrected; `decodeResponse` is added; redirects release discarded bodies | Relevant to residual-service types and custom application clients. The metadata view already uses decoded-and-response mode; it does not need `decodeResponse` to exist. [Inference](https://github.com/Effect-TS/effect/commit/837e906d9a476bff12fbd063d1635f748e1de7de), [decoder](https://github.com/Effect-TS/effect/commit/563fde0be33352e80c20d56ceac2d8daad39ab96), [redirect cleanup](https://github.com/Effect-TS/effect/commit/eedfb27f009c757078d094a6697e6e7d00fba06c). |

The [4.0.7 release notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.7) also include Schema behavior/type corrections and an experimental CircuitBreaker with HttpClient integration. Circuit breaking belongs in the supplied client, where applications can already adopt it after upgrading. Base64 changes are described upstream as reducing allocation and improving large-input encoding; this is not evidence of faster utility construction, query hashing, or end-to-end RPC.

### Effect 4.1.x: available within-major, currently quarantined

- **4.1.0:** opt-in RFC 9457 Problem Details, `RpcServer.onDisconnect`, and detection/fallback for unsupported fetch streaming bodies are useful application capabilities. The release also changes crypto services, cookie-store types, and discarded-RPC acknowledgement semantics; SchemaBinary peers must be coordinated for the changed envelope. These are concrete reasons not to assume `^4.0.6` is an innocuous compatibility promise. [4.1.0 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.0).
- **4.1.1:** fixes acknowledgements of stream chunks dropped during interruption, SSE JSON codec round-trips for rich values, finished-fiber span retention, and completed Effect-request retention. Adds an HTTP response-header timeout helper. These matter to cancellation, rich SSE and long-lived applications, but none was benchmarked here. [4.1.1 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.1).
- **4.1.2:** corrects cookie selection after final URL construction, malformed RPC-header handling, and idle OTLP exporter timers. Fixed-width binary integer schemas are opt-in protocol features, not a default adapter optimization. [4.1.2 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.2).

The package should not grow a second Problem Details, cookie jar, timeout, observability, or binary-protocol subsystem. It should preserve the decoded values, errors, services and cancellation behavior supplied by the selected Effect release.

### Query Core: keep the existing peer range

The eligible **5.105.0** release says there are no Core changes; React Query's matching release only updates Core. Updating the test pin would extend evidence, without a supported claim of a new adapter feature or faster runtime. [Core release](https://github.com/TanStack/query/releases/tag/%40tanstack/query-core%405.105.0), [React release](https://github.com/TanStack/query/releases/tag/%40tanstack/react-query%405.105.0).

After quarantine, the later patches are more valuable:

| Release | Specific upstream benefit to check |
| --- | --- |
| `5.105.1` | Fewer temporary allocations in tracked observer-notification checks; tighter `isFetching` filter types. Measure actual observer workloads before claiming an application improvement. [Release](https://github.com/TanStack/query/releases/tag/%40tanstack/query-core%405.105.1). |
| `5.105.2` | Cancelled streamed queries cannot publish late or start a delayed stream; in-flight callers follow replacement fetches after repeated invalidation; reduced infinite `maxPages` is honored; mutation pause/dehydration behavior is corrected; declarations lose a DOM-only type reference. Exercise cancellation and invalidation races, not just happy-path streams. [Release](https://github.com/TanStack/query/releases/tag/%40tanstack/query-core%405.105.2). |
| `5.105.3` | Cancelled retries no longer enter a paused state after their delay; static queries with no data can refetch after reset/invalidation. [Release](https://github.com/TanStack/query/releases/tag/%40tanstack/query-core%405.105.3). |

Keep the `>=5.104.4 <6` floor: `5.104.4` fixed cached `null` initial page parameters; the adapter's live `null` representation also depends on earlier streamed-query fixes. Lowering the floor to match a competitor is a regression risk. [Versioned changelog](https://github.com/TanStack/query/blob/%40tanstack/query-core%405.105.3/packages/query-core/CHANGELOG.md), [ADR 0010](../adr/0010-reuse-tanstack-query-core-as-a-peer.md).

## Consumer compatibility strategy

1. **Keep development/test pins separate from published peers.** The shared exact Effect catalog currently also sets the peer. An eventual broadened peer should be explicit, while the catalog keeps reproducible development versions. Do not bundle another Effect or Query Core copy to work around peer constraints. [Manifest](../../package.json), [build externals](../../vite.config.ts).
2. **Smallest evidence-based Effect expansion:** after testing both releases, consider `4.0.6 || 4.0.7`. This permits existing consumers and the eligible fixed release without claiming compatibility with untested patches or 4.1. This conflicts with the current exact-peer rule and needs an ADR revision. [ADR 0001](../adr/0001-target-effect-4-release-candidate.md).
3. **A patch-line range is a deliberate stronger promise:** `>=4.0.6 <4.1.0` admits future 4.0 patches; it needs continuing compatibility monitoring. `~4.0.7` excludes existing 4.0.6 consumers without necessity. `^4.0.6` also admits 4.1 and later unstable-module changes. The upstream [RpcClient](https://github.com/Effect-TS/effect/blob/effect%404.0.7/packages/effect/src/rpc/RpcClient.ts) and [HttpApiClient](https://github.com/Effect-TS/effect/blob/effect%404.0.7/packages/effect/src/http-api/HttpApiClient.ts) explicitly mark themselves unstable.
4. **When 4.1 is eligible, test it before extending support.** If no new upstream API is required, preserving the 4.0.6 minimum is preferable. If optional functionality needs a newer API, isolate it behind an explicit entry point or capability instead of raising every consumer's requirement. Maintaining multiple lines has a real testing cost; an exact coordinated upgrade remains valid if the project intentionally keeps ADR 0001.
5. **Query already has the appropriate major bound.** Upgrade test pins independently after eligibility; retain minimum-version coverage. Keep each framework wrapper and its resolved Core aligned. Svelte Query's own major is already 6 while its checked Core is 5; do not confuse wrapper and Core majors. [Framework fixtures](../../tests/framework-consumers/package.json).

Competitors do not eliminate dependency coordination: oRPC beta.48 depends on exact beta-family packages and declares Core `>=5.89.0`; tRPC 11.24.0 declares exact client/server peers and React Query `^5.80.3`. Their broader Query minimums are not compatibility evidence for this adapter. [oRPC package record](https://registry.npmjs.org/@orpc%2ftanstack-query/2.0.0-beta.48), [tRPC package record](https://registry.npmjs.org/@trpc%2ftanstack-react-query/11.24.0).

## Prioritized candidate changes

The priorities below are recommendations inferred from the comparison. They are not benchmark results or commitments to implement every item.

| Priority | Candidate | Why it merits work | Required evidence before shipping |
| --- | --- | --- | --- |
| P0 | Evaluate coordinated Effect `4.0.7`; decide whether to admit both tested patches | Relevant fixes are eligible now; avoid an unnecessary forced consumer upgrade | Both-version published-type and runtime matrix; RPC/HTTP cancellation, failures, services and native builds; strict lockfile resolution |
| P0 | Queue Query `5.105.2`/`5.105.3` verification for their eligibility dates | Upstream race fixes affect adapter behavior directly | Late-publication, repeated invalidation, infinite retention and retry regressions at the supported floor and new version |
| P1 | Document or offer opt-in rich-value structural sharing | oRPC beta supplies a reusable default for Date/URL/Map/Set/custom serializer values; this package currently relies on native policies | Reference-preservation and changed-value tests; custom-class/collection semantics; CPU/allocation/notification measurements |
| P2 | Serializable typed query references for loaders and client reads | tRPC's unstable handles connect a prefetch to the exact later read; current prepared inputs solve a different problem | Compile-time operation/input/view checks, JSON round-trip, owner/prefix mismatch rejection, infinite codecs, error/pending hydration behavior |
| P2 | Optional contract-annotation-to-configuration helper | oRPC's Contract Options plugin avoids repeating contract-related policy at utility creation | Typed annotations; precedence and callback tests; no serialized closures/services; reuse `configureUtils` rather than a second policy system |
| P2 | Typed HTTP NDJSON accumulated/live views | Effect already decodes framed records; this is an actual currently omitted adapter capability | Capability/type fixtures, framing-independent values, decode errors, services, retention, cancellation and snapshot tests |
| P3 | Multi-stream SSR convenience or selected-contract utility construction | May reduce repeated loader setup or large-contract work | Demonstrated application need; ownership-safe composition and construction/type/bundle baselines before a new public API |

### Rich data: improve ergonomics without changing identity

oRPC beta.48 supplies [rich structural sharing](https://github.com/middleapi/orpc/blob/v2.0.0-beta.48/packages/tanstack-query/src/structural-sharing.ts), [type-aware input serialization](https://github.com/middleapi/orpc/blob/v2.0.0-beta.48/packages/tanstack-query/src/key.ts), and [global hydration defaults](https://github.com/middleapi/orpc/blob/v2.0.0-beta.48/packages/tanstack-query/src/ssr.ts). These solve three distinct problems.

Here, input identity already comes from normalized payloads, Schema encoding, canonical JSON and optional custom encoders. Rich result hydration already has explicit codecs, including services. The actual convenience gap is reusable sharing of equivalent decoded rich data and less repetitive codec registration. Native `structuralSharing` can already be passed through `configureUtils` or call-site options. Start with a recipe or opt-in helper; do not promise automatic equality for arbitrary Effect classes, mutable collections, redacted values or user codecs. TanStack's [default sharing is designed for JSON-compatible data](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations).

Changing the default key serializer would affect cache identity, partial filters and hydration. It would require revisiting [ADR 0006](../adr/0006-use-canonical-semantic-json-for-payload-keys.md), with collision and migration tests. A global serializer also cannot infer an infinite query's application-defined page-parameter codec. Keep that distinction explicit.

### Typed prefetch references are distinct from prepared inputs

tRPC 11.24.0 includes `unstable_$prefetch`, `unstable_$ensure`, `unstable_$fetch` and `unstable_$fromHandle`. Its [published handle implementation](https://github.com/trpc/trpc/blob/v11.24.0/packages/tanstack-react-query/src/internals/handles.ts) describes a serializable key/input reference; the methods wrap native QueryClient operations. These remain explicitly unstable despite living in a stable package.

This package's [prepared input](../../src/core/prepared-input.ts) retains normalized execution input for one exact leaf owner and is deliberately nonserializable. It must not be advertised as a cross-request or server-to-browser handle. A separate optional query reference could prevent loader/component input drift while retaining native Query execution. It must not serialize ready clients, prepared handles, runners or authority. Ordinary typed keys plus hydration already cover basic prefetching, so adopt this only for a demonstrated SSR composition problem. [Prepared-input ownership decision](../adr/0031-add-explicit-query-reuse-and-stream-controls.md).

### Contract policies and SSR plugins are convenience gaps

oRPC's [Contract Options plugin](https://github.com/middleapi/orpc/blob/v2.0.0-beta.48/packages/tanstack-query/src/meta.ts) reads contract metadata as a base policy layer. This package does not read equivalent query policy annotations, but it already accepts reusable scoped configurations. An application helper can prove the benefit before introducing a general plugin protocol.

oRPC's [stream SSR plugin](https://github.com/middleapi/orpc/blob/v2.0.0-beta.48/packages/tanstack-query/src/ssr.ts) cancels server streams after data and arranges browser remount refetching. This package already has explicit snapshot acquisition and waits for local cleanup. An optional composition helper should preserve request ownership and deadlines; it should not dispose supplied clients or infer all server/worker lifecycles from the absence of `window`. [ADR 0007](../adr/0007-keep-the-core-factory-lifecycle-neutral.md), [ADR 0020](../adr/0020-generate-accumulated-and-live-stream-queries.md).

### NDJSON deserves a separate decision from byte streams

The [HTTP classifier](../../src/http/request.ts) admits one SSE success and omits NDJSON. Effect's [4.0.7 HttpApiClient](https://github.com/Effect-TS/effect/blob/effect%404.0.7/packages/effect/src/http-api/HttpApiClient.ts) already maps `StreamNdjson<S>` to `Stream<S["Type"], ...>` and decodes records with the schema's JSON codec. Those values have semantic record boundaries; raw byte chunks do not.

Supporting unambiguous NDJSON responses could reuse the stream cache machinery. It would need coordinated runtime/type classification and error/service extraction, while preserving existing SSE key identities and controls. Streaming request bodies, mixed success representations and upgrades can stay excluded. This extends the currently documented HTTP capability boundary; record the decision alongside [ADR 0024](../adr/0024-project-http-streams-and-buffered-metadata.md) rather than describing it as an Effect feature that does not exist.

## Local performance candidates

A separate read-only implementation pass found no confirmed functional defect. The following costs are visible in source; neither has been benchmarked as part of this task.

- **Configuration:** `configureNode` validates each configured child with `children.some`, then recursively reconstructs every descendant. A child-name Set can reduce validation lookup work; sparse configurations may also permit reuse of unaffected subtrees. Preserve inherited policy layers, callback order and prepared-input ownership. Measure sparse, dense and repeated configurations on the existing 1,000-operation fixture before changing the public construction model. [Implementation](../../src/core/configure-utils.ts), [eager-tree decision](../adr/0009-build-an-eager-frozen-utility-tree.md).
- **Accumulated history:** every publication produces a fresh retained array. An unbounded stream publishing each of N emissions copies a quadratic total number of array elements. Bounded histories, count/deadline publication batches and latest-value queries already mitigate this. A ring buffer alone cannot remove the cost of publishing an immutable full-array result. Measure allocations, observer notifications and long-running history sizes before adding another stream representation. [Reducer](../../src/core/streamed-query.ts), [publication controls](../../src/core/stream-publication.ts).

## Justified scope exclusions

- **Transport setup, batching, cookie jars, compression and retry links:** ready-client/application responsibilities. oRPC beta.48's new cookie, HEAD and streaming-batch facilities are [transport/server features](https://github.com/middleapi/orpc/releases/tag/v2.0.0-beta.48). TanStack deduplication and publication batching do not supply network batching. Automatic adapter batching would conflict with [ADR 0026](../adr/0026-keep-rpc-transport-aggregation-in-the-application.md).
- **OpenAPI, validation, server middleware, authentication and telemetry:** Effect supplies these contract/runtime facilities; the adapter should preserve their behavior. A framework-wide feature comparison would incorrectly charge this package for rebuilding its upstreams. Existing [server/host guidance](../../apps/docs/src/content/docs/reference/browser-and-worker-hosts.md) and external HTTP-client guidance provide application composition paths.
- **A parallel QueryClient, normalized entity cache, automatic mutation invalidation or optimistic rollback:** native Query callbacks, typed keys and application domain relationships already cover these. The repository includes [optimistic-write](../../apps/docs/src/content/docs/guides/optimistic-writes.md) and [event refresh](../../apps/docs/src/content/docs/guides/refresh-from-events.md) recipes.
- **Mutation cancellation with rollback guarantees:** TanStack does not supply the query abort signal to mutations. The repository already models explicit cancellable commands. Remote acknowledgement and undo are domain operations, not capabilities gained by copying tRPC subscription hooks. [Compatibility boundary](../../apps/docs/src/content/docs/reference/compatibility-and-limits.md).
- **Raw responses, byte-stream cache entries and live upgrade resources:** retaining these would mix transport lifetime with durable query data. Use the supplied client directly and application download sinks. [ADR 0024](../adr/0024-project-http-streams-and-buffered-metadata.md).
- **A universal SSR error serializer:** preserving a complete Cause does not establish which fields are public or reconstruct cross-realm `instanceof`. Keep failed-query transfer explicit and allowlisted. [Existing error-hydration guidance](../../apps/docs/src/content/docs/guides/hydrate-unary-data.md).

## Validation and measurement needed

For a future implementation, use the declared baseline with the repository's pinned pnpm and unchanged strict release-age settings. The initial stale installation has been restored, but cross-version compatibility remains unverified. Use isolated consumer matrices for Effect `4.0.6`/`4.0.7` and Core `5.104.4`/`5.104.5`/`5.105.0`; add later versions only after eligibility. Check the packed peer metadata and ensure each consumer resolves one Effect and one Query Core.

Use compile-time fixtures for published input/data/error inference, Schema service requirements, ready-client compatibility, configured overloads, conditional inputs, initial data, page parameters and supported HTTP shapes. Run `vp run api-types`, `vp run server-local-types`, `vp run framework-types`, and `vp run pack` as applicable. Keep the supported TypeScript 5.9 and current compiler checks; do not raise the consumer compiler minimum merely because the development compiler advances. [Task definitions](../../vite.config.ts).

Use runtime tests for transport interruption, decode failure during disconnect, finalizers, late stream publications, repeated invalidation, HTTP metadata, declared/compound failures and hydration round-trips. A rich-SSE upgrade deserves Date/BigInt/Option wire round-trip tests because 4.1.1 fixes that specific encoding boundary. Query's new cancellation fix deserves a stream that ignores its signal as well as the normal signal-consuming adapter path.

For performance work, use the existing `vp run construction-baseline`, `vp run type-baseline`, `vp run bundle-baseline`, and `vp run stream-baseline`. Compare identical contracts and inputs, warmup, runtime/dependency versions and machine conditions. Measure factory construction, ordinary versus reused prepared inputs, fresh option allocation, bounded/unbounded stream histories, observer notifications and cleanup separately. Rich-sharing work needs both unchanged and changed data; retention fixes need a controlled heap/GC experiment, not elapsed time alone. If comparing other adapters, hold transport, payloads and cache policies constant and respect quarantine before installing them. [Existing measurement guidance](../../apps/docs/src/content/docs/reference/performance.md).

The source-research phase executed no library tests or benchmarks and certifies no upgrade. Follow-up documentation work removed the prerelease migration page and its links and maintained the skill review records. `vp run docs-build` passed all 20 excerpt tests, Astro diagnostics, static generation and internal link validation, with external font-fetch warnings. `vp run pack` passed declaration generation, ATTW and publint. `vp exec intent validate skills --check` passed after restoring the declared installation. No library implementation, manifest or lockfile changed; no fresh consumer, wider-peer matrix or performance benchmark was run.
