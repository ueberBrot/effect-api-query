# Use flat prefix-matchable key tuples

Status: Amended by ADR 0018 and ADR 0020. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Applications need a shared key hierarchy for exact cache access and broad TanStack prefix filters.

## Decision

Generated keys concatenate a required readonly, non-empty JSON prefix, the adapter namespace,
the RPC path, and an operation discriminator. They append the canonical query payload when one
exists. Concrete query keys use TanStack's `DataTag`. Prefix and mutation keys remain ordinary
readonly keys.

## Consequences

Root, branch, RPC, and operation keys support TanStack's native array-prefix matching. Mutation
variables remain outside `mutationKey` because they arrive after option construction. The
package-level `viewPrefix(leaf, view)` helper selects a supported query view across every input and
stream policy of a leaf. It preserves the literal prefix without a DataTag. Callers add native
TanStack filter conditions and encoded partial input. ADR 0018 and ADR 0020 add operation
discriminators without changing the hierarchy.
