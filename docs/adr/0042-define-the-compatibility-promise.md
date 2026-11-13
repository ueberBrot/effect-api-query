# Define the compatibility promise

Status: Accepted. Prospectively amends the pre-1.0 versioning rule in [ADR 0001](0001-target-effect-4-release-candidate.md) and extends compatibility validation in [ADR 0033](0033-bound-effect-support-to-a-patch-line.md). Preserves their historical decisions and evidence.

## Context

Spec #166 ticket #168 requires a complete public contract and reproducible evidence for both bounded peers. The current manifest already admits Effect 4.0 and 4.1; ADR 0033 records the initial 4.0-only decision. Existing floor/current tests miss maintained 4.0 patches and Query Core's floor. Historical pre-1.0 versioning treats breaking changes as minor, which conflicts with the new support promise.

## Decision

Retain `effect >=4.0.6 <4.2.0` and `@tanstack/query-core >=5.104.4 <6`. Check the Cartesian product of Effect minimum 4.0.6, 4.0 representative 4.0.7, development 4.1.0 and 4.1 representative 4.1.2 with Query Core minimum 5.104.4 and development 5.105.0. Pinned representatives are refreshed through explicit review, not dynamic latest selection. Keep strict seven-day age enforcement. [Effect registry metadata](https://registry.npmjs.org/effect) and [Query Core registry metadata](https://registry.npmjs.org/@tanstack%2fquery-core) verify these versions are eligible; Effect 4.1.3/4.1.4 are too young at the 2026-11-13 review. This does not update development pins or promise upstream backports.

Packed consumers run public fixtures under pinned TSRS and minimum TypeScript 5.9.3, plus selected execution, stream, cancellation and hydration regressions. Verify artifact imports and the packed library's peers against consumer resolution. Framework consumers/builds remain separate evidence for the selected development combination. Support ranges admit untested intermediate versions; exact combinations are evidence rather than exhaustive certification. Review future Effect minors and TypeScript majors explicitly. Applications coordinate their Effect packages and native Query wrappers.

For future changes, compatible fixes/internal tooling are patch changes; additive capabilities/verified range extensions are minor changes; breaking contracts or dropping supported dependency/compiler versions are major changes, even below 1.0. Raising a floor is a support drop. Preserve historical release classifications. This decision authorizes no publication or release scheduling.

## Consequences

The [compatibility guide](../../apps/docs/src/content/docs/getting-started/compatibility-and-stability.md) defines builders/inference, identity, normalization, errors, hydration and local cancellation/cleanup guarantees. CI runs the same matrix as `vp run effect-compatibility`. No peer bound is widened and no runtime implementation changes. Future upstream failures require review and truthful reporting, not automatic range changes or weakened fixtures.
