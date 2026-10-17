# Effect API Query skill coverage

The package builds TanStack Query utilities from Effect RPC and HTTP contracts and ready clients.
Applications own transport, authentication, runtime, Scope, cache ownership, and serialization policy.

## Structure

One `effect-api-query` skill covers the library. Its activation description supports automatic discovery.
The entry point contains shared rules and directs conditional tasks to six references:

| Reference            | Tasks                                                              |
| -------------------- | ------------------------------------------------------------------ |
| RPC                  | Payload construction, canonical identity, ready-client lifetime    |
| HTTP                 | Decoded requests, SSE, multipart mutations, metadata               |
| Query patterns       | Inference types, skipping, pagination, stream views and tracing    |
| Cache workflows      | Typed policies, native defaults, view filters, writes and owners   |
| Hydration and SSR    | Snapshots, paired view codecs, preparation and cleanup             |
| Frameworks and hosts | Provider setup, Suspense, reactive accessors, transports and hosts |

Consumers load the guidance from installed `@ueberbrot/effect-api-query` without
repository-local authoring skills. Planning records remain outside the shipped package.

## Sources and boundaries

The [domain map](domain_map.yaml) records task coverage and failure modes.
The [skill tree](skill_tree.yaml) records skill paths and source mappings.
Public declarations and runtime define API facts. Application modules define domain and cache coordination.
Library documentation explains generated options, keys, inference, policies, and cleanup contracts.
Integration pages explain native providers and consumers. Runnable examples demonstrate application protocols.

Keep guidance within existing library behavior. Preserve application ownership
and qualify support through [frameworks and hosts](../skills/effect-api-query/references/frameworks-and-hosts.md).
Measurements describe their fixtures. They do not establish universal budgets.

## Validation

Native Intent maintenance detects source changes and records justified outcomes for the owned skill and planning records.
Run `intent maintainer check` and report pending work. Finish with the uncached scoped `skills-check` task.
Leave unrelated skills unresolved.

Strict compiler fixtures check public declarations and documentation examples.
Runtime tests and application examples cover cache views, cancellation, hydration, and ownership.
Native builds validate package declarations and exports.

The usability batch reuses the existing executable consumer fixtures:

| Task                                                                            | Checks                                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Infer operation inputs, views, and failures with local policy inference         | `tests/types/helper-contract.ts`, `tests/types/docs-policies.ts`, `tests/query-policy.test.ts`                            |
| Select every input of a supported view and preserve exact tagged reads          | `tests/query-view-prefix.test.ts`, `tests/types/helper-contract.ts`                                                       |
| Share typed RPC and HTTP retry decisions                                        | `tests/types/docs-retry.ts`                                                                                               |
| Acquire, provide, render, and dispose a minimal React application               | `tests/types/docs-react-setup.tsx`, `tests/types/docs-react-entry.ts`, `examples/vite-react/tests/minimal-setup.test.tsx` |
| Reset initial Suspense errors, retain failed-refetch data, start reads together | `tests/types/docs-suspense.tsx`, `examples/vite-react/tests/suspense-recovery.test.tsx`                                   |
| Trace lazy stream emissions and awaited cleanup                                 | `tests/types/docs-stream-tracing.ts`, `examples/vite-react/tests/stream-tracing.test.ts`                                  |

These checks verify the recommended APIs and observable behavior.
A fresh isolated consumer session supplies separate evidence.
This authoring session does not establish skill discovery or consumer reliability.

## Coverage and batch history

- 0.1.0 candidate, source `6893603` (2026-10-10): One skill and six references
  cover the ten developer tasks in the domain map. Guidance covers originating
  cache owners, overlapping writes, stream capture, preparation drain, paired
  hydration codecs, and framework and host limits. CI `38085762210` and release
  validation `38085762195` passed. Publication remains separate.
- Maintainer alignment (2026-10-10), based on `6893603`: Pin native Intent 0.5.3
  under the seven-day dependency policy. Add its revision-aware check to CI.
  Default discovery excludes hidden repository authoring skills. Preserve task
  coverage, source mappings, and package-only distribution. Skills CLI 1.7.0
  discovered and copied the skill from the repository root. All seven files
  matched, and all 13 relative links resolved within the copy. Guidance did not
  change, so the batch checked delivery without repeating API tasks. Scoped
  formatting, skill validation, and native maintainer checks passed with the
  default and actual PR bases. Initial package publication remains pending.
- API and architecture review (2026-10-11), based on `bf38d85`: Use one
  conditional-input form for buffered, metadata, streamed, and live options.
  Retain the ten tasks and source mappings. Compiler fixtures verify contextual
  inference and mutation tracking. The 124 in-memory runtime cases cover cache
  views, retry attempts, defaults, hydration, cancellation, and ownership.
- Runtime and guidance audit (2026-10-11), based on `54b6521`: State the limits
  of stream hashing and execution errors. Preserve refreshed page totals during
  overlapping writes and reconcile command starts after transport failures.
  Shorten repeated guidance while retaining the ten tasks, domain map, and
  source mappings. All 474 runtime cases and both public API compiler suites
  pass. Typed lint, Effect diagnostics, dead-code checks, and documentation
  checks also pass.
- Functionality and lifetime review (2026-10-11), based on `512cd90`: Organize
  documentation around queries, mutations, pagination, streaming, and metadata.
  Request disposal drains ordinary query finalizers and accepted writes.
  Rollback respects newer authoritative cache revisions. Clarify selected
  return values and the encoder requirement for opaque middleware. Preserve
  the ten tasks and six references. Existing source mappings cover the new
  guides and compiler fixture. Remove runtime cases that duplicate static
  contracts, upstream behavior, or bookkeeping. All 491 remaining runtime
  cases and both public API compiler suites pass. Documentation builds with
  valid links. All 38 application and documentation Chromium checks pass.
- Usability and policy reuse (2026-10-11), based on `8f4723c`: Extend the skill
  and six references with operation inference, supported view prefixes, and
  typed query and mutation policies. Add native provider setup, Suspense
  recovery, and tracing of consumed streams. Keep inputs, projections, seeds,
  page mapping, stream identity, and optimistic context local. Call-site
  callbacks replace shared policy callbacks. Preserve native QueryClient
  defaults, canonical encoded partial filtering, application lifetime, and
  prior task coverage. Semantic near-miss duplication detection found the
  repeated retry recipe. Shared owner invalidation and error descriptions
  reduce example drift. Expand source mappings for TSX fixtures and shared
  example error rendering. A fresh consumer invoked the copied packaged skill
  and produced typed policy builders in a disposable project. Behavior checks
  passed and rejected the initial version without shared defaults. The result
  compiled on TypeScript 7 and 5.9. Skill discovery remains unverified. Final
  compiler, runtime, documentation, and revision-bound Intent outcomes are
  recorded in the task's maintenance review.
- Library-focused documentation (2026-10-11), based on `8f4723c`: Separate
  library contracts, native integrations, runnable application examples, and
  API reference. Keep the fourteen tasks and six shipped references. Type
  Inference owns the detailed inference contract. Defaults and Policies owns
  shared defaults and callbacks. Cache Keys and Filters replaces Cache
  Management. Fold ready-client mounting into React Query and move the explicit
  command protocol to Cancellable Commands. Update shipped pointers to those
  canonical pages and the integration overview. Existing skill-tree source
  patterns cover the new and moved pages. Skill identities and mappings remain
  accurate. Preserve the fresh-consumer evidence above. This reorganization
  changes where guidance is reached while retaining its recommended API behavior.
- Plain-English revision (2026-10-11), based on `0feea99`: Rewrite the docs site,
  README, glossary, release guidance, ADRs, and shipped guidance. Read Humanizer,
  Simple English, and the pinned technical-writing guide without installing them.
  Use `writing-for-agents` for ADR decisions and shipped skill instructions.
  Preserve decision context, constraints, completion checks, and conditional pointers.
  Keep `.agents/`, `docs/agents/`, and `AGENTS.md` unchanged.
  Remove prose dashes, shorten dense sentences, and state ownership explicitly.
  Preserve examples, identifiers, links, activation metadata, fourteen tasks,
  and six references. The domain map retains the same coverage and failure modes.
  The skill tree retains the same identities, dependencies, and source mappings.
  The documentation build passes with valid internal links. Retained examples
  pass the TypeScript 7 and 5.9 compiler fixtures. Formatting and structural
  skill validation pass. Final maintainer outcomes are recorded in the Intent review.
  This prose revision does not repeat the prior fresh-consumer exercise or establish
  new skill-discovery evidence.
