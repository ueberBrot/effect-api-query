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
