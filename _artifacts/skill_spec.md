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
for the owned skill and planning records. Leave unrelated skills unresolved and
run the uncached scoped `skills-check` task.

The packed-consumer verifier checks installed version and peers, package-only
discovery, reference resolution, archive inventory, and skill examples with both
supported compilers and Query peers. Runtime fixtures cover cached views,
cancellation and preparation, hydration, cache ownership, and reactive framework
hosts. Independent consumer execution checks that the guidance supports actual
tasks.
