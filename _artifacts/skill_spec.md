# Effect API Query skill coverage

The package derives TanStack Query utilities from Effect RPC and HTTP contracts and
ready clients. Applications retain transport, authentication, runtime, Scope, cache
ownership, and serialization policy.

## Domains and inventory

| Domain                           | Skill            | Type | Coverage                                                                                                                     |
| -------------------------------- | ---------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| Contract-derived query workflows | effect-api-query | Core | Adapter inputs, keys/options, cached views, native workflows, lifecycle, hydration, reactive consumers, and transport limits |

The existing single skill remains automatically discoverable through the package.
Its entry point holds shared rules and routes tasks to RPC, HTTP, query patterns,
cache workflows, hydration/SSR, and framework/host references. Consumers need no
authoring tools or repository-local agent skills to use this guidance.

## Failure modes

| Mistake                                               | Priority | Source                                              |
| ----------------------------------------------------- | -------- | --------------------------------------------------- |
| Reuse an accumulated key across incompatible policies | High     | src/rpc/streamed-query.ts                           |
| Dispose resources after native cancellation alone     | High     | src/core/stream-snapshot.ts                         |
| Roll back an overlapping write with an old snapshot   | Critical | examples/vite-react/src/lib/user-writes.ts          |
| Redirect late callbacks to a replacement owner        | Critical | examples/vite-react/src/lib/user-writes.ts          |
| Hydrate rich values without paired view codecs        | High     | tests/packed-consumer/hydration-views-runtime.mts   |
| Construct reactive query options only once            | High     | tests/packed-consumer/vue-solid-contract.ts         |
| Rely on changed metadata options after a fresh hit    | High     | apps/docs/src/content/docs/guides/query-defaults.md |

The domain map records mechanisms and task coverage. The skill tree owns paths and
source mappings. Public declarations and runtime own API facts; tested application
modules and guides own recommended cache and lifecycle recipes.

## Decisions and boundaries

- Preserve one library skill rather than introducing prerequisite or framework
  skills for existing branches. Conditional references avoid loading every workflow.
- Migrate the original description to purpose, then apply the approved correction
  for the settled HTTP and framework scope. Keep activation task-oriented and
  record the verified package version, currently 0.0.0.
- Keep package-only distribution. Planning records and review state remain outside
  shipped skills and the package allowlist.
- Keep scoped native skill validation in the existing uncached task and CI path.
  Record revision-bound source and planning reviews with actual task evidence.
  Repository-wide native review also selects unrelated local authoring skills,
  so it cannot serve as this library skill's CI gate. Preserve those unresolved
  items and the existing pinned installer semantics.
- Keep the audited coordinated Effect 4.0.0 set. The buffer-16 cancellation control
  covers one acknowledged 16-value chunk, zero consumption, immediate request-Scope
  closure, and concurrent unary success. Larger chunks and unfinished offers remain
  unverified; buffer-one overflow, chunk Schema isolation, and single-element
  GET/form payload-array limitations remain explicit.
- Add no clients, providers, codecs, invalidation helpers, transport aggregation,
  batching, framework adapters, or public API. Measured fixtures do not define
  universal timing, memory, renderer, or application-bundle budgets.

## Task checks

The existing packed-consumer verifier checks package-only Intent discovery/loading,
installed version, reference resolution, exact archive inventory, and every TypeScript
example with both supported compilers and Query peers. Its runtime fixtures exercise
policy identity, snapshot drain and abort, metadata sharing, hydration preparation,
optimistic overlap, events, owner retirement, and native reactive framework hosts.
Native maintenance checks separately validate records and detect source changes.
Fresh-context consumer execution supplies an independent task check; neither native
bookkeeping nor syntax validation establishes semantic correctness by itself.

## Coverage and batch history

- At source revision `8b2b346ebe98e134de19a9ff5bff91c431fd80c3`, the initial maintenance
  batch registers the existing root-package skill and its source-backed tasks.
  It corrects stream policy identity, adopts the public snapshot helper, and adds
  conditional metadata, cache ownership, hydration, reactive framework, transport,
  and performance-limit guidance. The migrated purpose receives the approved HTTP/framework scope correction.
  The full packed-consumer matrix passes with both supported compilers and Query
  peers. Independent consumer execution verifies numeric stream snapshots, awaited
  cleanup before dehydration, paired metadata codecs, and sharing policies. Its
  fresh-cache experiment adds a native imperative option-installation caveat to
  the HTTP reference; all ten TypeScript examples remain unchanged.
  Source coverage includes README and all Markdown/MDX site pages so the final
  documentation reconciliation requires a native review. Check outcomes and
  justified source reviews are recorded before handoff.
  Independent Standards review narrows the buffer-16 statement to the acknowledged
  16-value chunk, zero-consumption, immediate request-Scope closure control with
  concurrent unary success. Larger chunks and unfinished offers remain unverified;
  the reproduced overflowing buffer-one and chunk-Schema limits remain explicit.

- At source revision `a55b931a093f380b79b8d3d714cb3ec640a1411c`, human documentation
  reconciliation aligns capability summaries, captured inputs, metadata policy
  installation, local cleanup, exact tested versions, and application ownership
  with the maintained skill. Earlier-build migration language is removed because
  the package is unreleased. The exact-peer ADR retains its architectural rationale
  and upgrade validation responsibility while configuration mechanics are removed.
  Existing recipes and skill examples retain their behavior and source mappings.
  Documentation snippets, Astro diagnostics, scoped skill validation, and the
  fresh packed-consumer matrix pass. The worktree's Starlight build cannot resolve
  virtual style metadata through linked dependencies; canonical build and browser
  checks remain required before integration.

## Remaining work

Following approved slices update skill version metadata during manual 0.1.0
preparation and verify the exact candidate archive. Their actual source changes
require a new native review. Framework SSR/AOT,
cross-host worker transport, durable event delivery, and future dependency releases
remain outside the verified integration scope.

The pre-migration description was: “Use effect-api-query to derive TanStack Query
options and cache keys from Effect RPC or HttpApi contracts. Load when wiring
createRpcQueryUtils or createHttpApiQueryUtils, choosing query or mutation builders,
adding pagination or RPC streams, configuring cache identity, handling execution
failures or cancellation, or integrating the library with React Query or SSR.”
The approved purpose correction includes the now-verified HTTP views and native
framework/host branches rather than retaining the old RPC/React emphasis.
