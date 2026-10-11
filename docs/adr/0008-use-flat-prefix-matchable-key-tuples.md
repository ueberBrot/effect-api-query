# Use flat prefix-matchable key tuples

Status: Amended by ADR 0018 and ADR 0020. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Applications need one key hierarchy for exact cache access and broad TanStack prefix filters.

## Decision

Generated keys concatenate a required readonly, non-empty JSON prefix, the adapter namespace,
the RPC path, an operation discriminator, and a canonical query payload when present. Concrete query keys use TanStack's
`DataTag`; prefix and mutation keys remain ordinary readonly keys.

## Consequences

Root, branch, RPC, and operation keys support TanStack's native array-prefix matching. Mutation
variables remain outside `mutationKey` because they arrive after option construction. The
package-level `viewPrefix(leaf, view)` helper selects a supported query view for every input and
stream policy of a leaf, preserving its literal prefix without a DataTag. Callers add native
TanStack filter conditions and encoded partial input themselves. ADR 0018 and ADR 0020 add operation discriminators without
changing the hierarchy.
