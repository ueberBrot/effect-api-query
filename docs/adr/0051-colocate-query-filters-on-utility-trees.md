# Colocate query filters on generated utility trees

Status: Accepted. Partially amends [ADR 0003](0003-project-dotted-rpc-tags-into-utility-paths.md) and extends [ADR 0028](0028-bind-partial-filters-to-explicit-projections.md). Partially amended by [ADR 0054](0054-match-stream-policies-in-leaf-query-filters.md).

## Context

Applications filter cache entries by a utility path, a query view, or a complete input. Standalone builders also covered whole views, and branch view filters walked the utility tree. That walk would construct lazy leaves introduced by [ADR 0046](0046-lazy-memoized-frozen-leaves-and-unified-key-inputs.md).

## Decision

Expose `.queryFilter(options?)` on RPC and HTTP roots, branches, and queryable leaves. Reserve `queryFilter` as a path segment. Multipart HTTP mutation leaves have no query filter.

Use `view` to select a query view. Root and branch filters match supported descendant views using path metadata collected at construction. They leave lazy leaves untouched and combine their view match with native filter conditions.

Leaf filters accept `input` only alongside `view`. Full and prepared input use the same canonical encoding as the concrete key builders. The resulting key is a prefix, so stream policies remain outside the match. Exact stream entries still use the complete key from the view's key builder.

Remove `createBranchQueryFilter`. Keep `createQueryFilter(leaf, view, encode)` for partial-input projections. The caller still supplies the encoded fields to match, as required by ADR 0028.

## Consequences

Applications can pass a generated filter directly to native QueryClient methods. Configuration and query-owner tracking preserve the filter builders and their cache identity.
