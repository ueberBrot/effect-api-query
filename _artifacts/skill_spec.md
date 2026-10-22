# Effect API Query skill coverage

The package builds TanStack Query utilities from Effect RPC and HTTP contracts and ready clients. Applications own transport, authentication, runtime, Scope, cache ownership, and serialization policy.

## Structure

One `effect-api-query` skill covers the library. Its activation description supports automatic discovery. The entry point contains shared rules and directs conditional tasks to six references:

| Reference | Tasks |
| --- | --- |
| RPC | Payload construction, canonical identity, ready-client lifetime |
| HTTP | Decoded requests, SSE, multipart mutations, metadata |
| Query patterns | Inference, skipping, pages, publication batches, recovery and tracing |
| Cache workflows | Typed policies, interceptors, partial filters, writes and owners |
| Hydration and SSR | Snapshots, typed view registration, preparation and cleanup |
| Frameworks and hosts | Provider setup, Suspense, reactive accessors, versions, transports and hosts |

Consumers load the guidance from installed `@ueberbrot/effect-api-query` without repository-local authoring skills. Planning records remain outside the shipped package.

## Sources and boundaries

The [domain map](domain_map.yaml) records task coverage and failure modes. The [skill tree](skill_tree.yaml) records skill paths and source mappings. Public declarations and runtime define API facts. Application modules define domain and cache coordination. Library documentation explains generated options, keys, inference, policies, and cleanup contracts. Integration pages explain native providers and consumers. Runnable examples demonstrate application protocols.

Keep guidance within existing library behavior. Preserve application ownership and qualify support through [frameworks and hosts](../skills/effect-api-query/references/frameworks-and-hosts.md).

## Validation

Native Intent maintenance detects source changes and records justified outcomes for the owned skill and planning records. Run `intent maintainer check` and report pending work. Finish with the uncached scoped `skills-check` task. Leave unrelated skills unresolved.

Strict compiler fixtures check public declarations and documentation examples. Runtime tests and application examples cover cache views, cancellation, hydration, and ownership. Native builds validate package declarations and exports.

The usability batch reuses the existing executable consumer fixtures:

| Task | Checks |
| --- | --- |
| Infer operation inputs, views, and failures with local policy inference | `tests/types/helper-contract.ts`, `tests/types/docs-policies.ts`, `tests/query-policy.test.ts` |
| Select every input of a supported view and preserve exact tagged reads | `tests/query-view-prefix.test.ts`, `tests/types/helper-contract.ts` |
| Share typed RPC and HTTP retry decisions | `tests/types/docs-retry.ts` |
| Acquire, provide, render, and dispose a minimal React application | `tests/types/docs-react-setup.tsx`, `tests/types/docs-react-entry.ts`, `examples/vite-react/tests/minimal-setup.test.tsx` |
| Reset initial Suspense errors, retain failed-refetch data, start reads together | `tests/types/docs-suspense.tsx`, `examples/vite-react/tests/suspense-recovery.test.tsx` |
| Trace lazy stream emissions and awaited cleanup | `tests/types/docs-stream-tracing.ts`, `examples/vite-react/tests/stream-tracing.test.ts` |

These checks verify the recommended APIs and observable behavior. A fresh isolated consumer session supplies separate evidence. This authoring session does not establish skill discovery or consumer reliability.

## Coverage and batch history

- **2026-10-10, `6893603`:** Establish one skill and six references covering ten tasks: cache owners, overlapping writes, stream capture, preparation drain, view codecs, and host limits. CI `38085762210` and release validation `38085762195` passed; publication remained separate.
- **Maintainer alignment, `6893603`:** Pin Intent 0.5.3 under the seven-day policy and add revision-aware CI checks. Keep package-only distribution and hidden authoring skills outside default discovery. Skills CLI 1.7.0 copied all seven files with 13 valid relative links. Scoped checks passed with default and PR bases. Guidance was unchanged, so API tasks were not repeated.
- **2026-10-11, `bf38d85`:** Unify conditional input across buffered, metadata, streamed, and live options. Preserve task coverage and source mappings. Compiler fixtures check inference and mutation tracking; 124 in-memory runtime cases cover views, retries, defaults, hydration, cancellation, and ownership.
- **Runtime audit, `54b6521`:** Clarify stream hashing and execution-error limits. Preserve refreshed totals during overlapping writes and reconcile command starts after transport failures. All 474 runtime cases, both compiler suites, typed lint, Effect diagnostics, dead-code checks, and docs checks passed.
- **Lifetime review, `512cd90`:** Organize guides by operation. Drain query finalizers and accepted writes before disposal; preserve newer cache revisions during rollback. Clarify selected results and opaque-middleware encoders. Remove redundant tests while retaining ten tasks and six references. All 491 runtime cases, both compiler suites, linked docs builds, and 38 Chromium checks passed.
- **Policy reuse, `8f4723c`:** Add inference, view prefixes, typed policies, provider setup, Suspense recovery, and consumed-stream tracing. Keep projections, seeds, page mapping, identity, and optimistic context local; callbacks replace shared defaults. Share example invalidation and error descriptions and expand TSX/error-rendering mappings. A disposable consumer used the copied packaged skill to build typed policies, passed behavior checks, rejected the version without shared defaults, and compiled on TS7 and TS5.9. Automatic discovery remained unverified.
- **Documentation structure, `8f4723c`:** Retain fourteen tasks and six references. Separate library contracts, native integrations, examples, and reference. Make Type Inference, Defaults and Policies, and Cache Keys and Filters canonical. Fold provider setup into React Query and the command protocol into Cancellable Commands. Preserve prior consumer evidence and update pointers without changing API behavior.
- **Plain English, `0feea99`:** Revise docs, README, glossary, ADRs, and shipped guidance while preserving decisions, examples, identifiers, fourteen tasks, six references, activation metadata, and mappings. Keep repository agent instructions unchanged. Docs links, both compiler suites, formatting, and skill validation passed. This revision added no consumer-discovery evidence.
- **2026-10-20, `0ea1465`:** Add typed partial filters, optional callback composition and execution interception, count-based publication, cursor recovery, and typed hydration registration. Preserve native Query behavior and application-owned transport and cleanup. Metadata provenance survives observer replacement and interceptors; contract analysis shares no clients or runtimes. New ADRs 27–29 state the changed or extended decisions. Adopt eligible runtime updates and the Ultracite lint and formatter presets with the library import group. Scope necessary exceptions to contract boundaries. Replace broad protocol assertions with native guards and keep dynamic type boundaries explicit. Two independent consumer passes compiled on TS7 and TS5.9 and passed 16 final behavior checks; automatic discovery remains unverified. Runtime, compiler, docs, and revision-bound Intent evidence is recorded after final checks.
- **Architecture review, 2026-10-20, `0ea1465`:** Complete two passes. Correct empty HTTP success inference and preserve complete Causes through stream finalization, pending-pull cancellation, and recovery cleanup. Give each correctness fix its own patch changeset. Consolidate leaf/view inference and distinguish completed schema analysis from retryable inspection. Preserve application ownership and justified type erasure. All 632 library runtime tests and both public compiler suites pass. A fresh published consumer passes 35 behavior checks and both compilers; automatic skill discovery remains unverified.
- **Released documentation, 2026-10-20, `0ea1465`:** ADR 30 replaces deployment on every main merge with deployment after successful root publication. Permit manual documentation-only corrections against a verified released tag; reject library and dependency changes. Display the built package version and verify static metadata before deployment. Keep the existing skill and six references; extend version-selection guidance and its source mapping. Workflow validation passes 76 tests, and updated documentation passes four Chromium cases. Live publication and deployment remain untested locally.
- **Query usability, 2026-10-22, package `0.2.0`:** Keep one skill and six references; extend query and cache guidance for prepared inputs, configured leaves, branch view filters, tagged failures, publication deadlines, and uncached event consumption. ADR 31 preserves existing keys and application ownership. Three architecture rounds led to exact policy checks and preservation of cleanup failures when cancellation races a deadline. Compiler and runtime regressions pass. A fresh packaged-skill consumer passes TS7, TS5.9, and the dashboard grader; broad invalidation fails the negative control. Correct the skill's stale version metadata to match the tested package. Automatic discovery remains unverified.
