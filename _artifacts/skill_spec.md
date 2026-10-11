# Effect API Query skill coverage

The package derives TanStack Query utilities from Effect RPC and HTTP contracts
and ready clients. Applications own transport, authentication, runtime, Scope,
cache ownership, and serialization policy.

## Structure

One automatically discoverable `effect-api-query` skill covers the existing
library. Its entry point holds shared rules and routes conditional tasks to six
references:

| Reference            | Tasks                                                            |
| -------------------- | ---------------------------------------------------------------- |
| RPC                  | Payload construction, canonical identity, ready-client lifetime  |
| HTTP                 | Decoded requests, SSE, multipart mutations, metadata             |
| Query patterns       | Skipping, pagination, accumulated and live views                 |
| Cache workflows      | Defaults, filters, overlapping writes, events, owner replacement |
| Hydration and SSR    | Snapshots, paired view codecs, preparation and cleanup           |
| Frameworks and hosts | Reactive accessors, transports, version and host limits          |

Consumers load the guidance from their installed package without repository-local
authoring skills. Planning records remain outside the shipped package.

## Sources and boundaries

The [domain map](domain_map.yaml) owns task coverage and failure modes. The
[skill tree](skill_tree.yaml) owns skill paths and source mappings. Public
declarations and runtime own API facts; application modules and guides own cache
and lifecycle recipes.

Keep guidance within existing library behavior. Preserve application ownership
and qualify support through [frameworks and hosts](../skills/effect-api-query/references/frameworks-and-hosts.md).
Measurements describe their fixtures; they do not establish universal budgets.

## Validation

Native Intent maintenance detects source changes and records justified outcomes
for the owned skill and planning records. Run `intent maintainer check`, report
pending work, and finish with the uncached scoped `skills-check` task. Leave
unrelated skills unresolved.

Strict compiler fixtures check the public declarations and retained documentation
examples. Ordinary runtime tests and application examples cover cache views,
cancellation, hydration, and ownership. Native builds validate package
declarations and exports.

## Coverage and batch history

- **0.1.0 candidate, source `6893603` (2026-10-10):** one skill and six references
  cover the ten developer tasks in the domain map. Guidance includes originating
  cache owners, overlapping writes, stream capture and preparation drain, paired
  hydration codecs, and qualified framework and host limits. CI `38085762210`
  and release validation `38085762195` passed; publication remains separate.
- **Maintainer alignment (2026-10-10), based on `6893603`:** pin native Intent
  0.5.3 under the seven-day dependency policy and add its revision-aware check to
  CI. Its default discovery excludes hidden repository authoring skills. Preserve
  the existing task coverage, source mappings, and package-only distribution.
  Skills CLI 1.7.0 discovered and copied this same skill from the repository root:
  all seven files matched, and all 13 relative links resolved within the copy.
  Guidance is unchanged, so this batch checks delivery without repeating API
  tasks. Scoped formatting, skill validation, and native maintainer checks with
  the default and actual PR bases passed. Initial package publication remains
  pending.
- **API and architecture review (2026-10-11), based on `bf38d85`:** use one
  conditional-input form across buffered, metadata, streamed, and live options.
  Retain the ten tasks and existing source mappings. Compiler fixtures verify
  contextual inference and mutation tracking; 124 in-memory runtime cases cover
  cache views, retry attempts, defaults, hydration, cancellation, and ownership.
- **Runtime and guidance audit (2026-10-11), based on `54b6521`:** qualify stream
  hashing and execution errors, preserve refreshed page totals during overlapping
  writes, and reconcile command starts after transport failures. Shorten repeated
  guidance while retaining the ten tasks, domain map, and source mappings. All
  474 runtime cases and both public API compiler suites pass, alongside typed
  lint, Effect diagnostics, dead-code checks, and documentation checks.
- **Functionality and lifetime review (2026-10-11), based on `512cd90`:** organize
  documentation around queries, mutations, pagination, streaming, and metadata.
  Request disposal drains ordinary query finalizers and accepted writes; rollback
  respects newer authoritative cache revisions. Clarify selected return values
  and opaque middleware's encoder requirement. Preserve the ten tasks and six
  references; existing source mappings cover the new guides and compiler fixture.
  Remove runtime cases that duplicate static contracts, upstream behavior, or
  bookkeeping. All 491 remaining runtime cases and both public API compiler
  suites pass. Documentation builds with valid links, and all 38 application and
  documentation Chromium checks pass.
