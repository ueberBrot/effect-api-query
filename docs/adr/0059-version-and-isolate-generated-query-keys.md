# Version and isolate generated query keys

Status: Accepted. Partially amends [ADR 0008](0008-use-flat-prefix-matchable-key-tuples.md). Applies to [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md), [ADR 0047](0047-derive-hydration-codecs-from-contracts.md), and [ADR 0051](0051-colocate-query-filters-on-utility-trees.md).

## Context

The flat caller prefix has no boundary before the adapter and path. Distinct trees can produce identical complete keys. TanStack also treats structured values in a native prefix as partial matches. Root and branch filters and native prefix defaults can select entries from another tree.

## Decision

Use the v2 format for every generated key. Serialize the complete canonical caller tuple as one scalar namespace segment, prefixed with `effect-api-query:v2:`. Keep the adapter discriminator, optional HTTP API identifier, and individual path segments after it. End a leaf path with `null`, then append the view or mutation discriminator and any existing query input and policy suffix.

Native matching compares the entire namespace segment and each path segment, even for prefix defaults. Roots and branches still select descendants. View selection, filters, and hydration share the same leaf framing. Generated view codec and branch-view matching bound the suffix to the input and policy slots. Complete legacy generated keys and complete v2 generated keys are disjoint. The old mandatory string path and operation discriminator cannot occupy the new leaf terminator, and its optional input can only be followed by a policy object.

## Consequences

Applications upgrading a persisted TanStack cache must change their storage version or buster and discard prior snapshots before hydrating. The library cannot infer the originating tree from a legacy tuple, so it provides no automatic rekeying. Deploy matching library versions on both sides of SSR and invalidate stored HTML or serialized state from the previous version. Native broad prefix operations still include app-defined descendants and assume a cache restored under the current version. Persisted DTOs with explicit application-owned identity can be restored through current key builders.

Rebuild hand-authored keys and prefix defaults with generated builders. Use each tree's filter for cross-adapter invalidation. The public tuple format change requires a pre-1.0 minor release under [ADR 0001](0001-target-effect-4-release-candidate.md).
