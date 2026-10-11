# Let call sites choose query or mutation

Status: Amended by ADR 0018 and ADR 0020.

## Context

Effect RPC contracts do not classify operations as reads or writes. Requiring a separate
classification here duplicates the contract.

## Decision

Every unary RPC leaf exposes `queryOptions` and `mutationOptions`. Call sites choose the TanStack
semantics. Leaves have no direct execution helper.

## Consequences

ADR 0018 adds infinite queries to unary leaves. ADR 0020 adds streaming leaves and supersedes their
omission from this decision.
