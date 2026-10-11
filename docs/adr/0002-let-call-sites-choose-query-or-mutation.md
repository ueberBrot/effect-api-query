# Let call sites choose query or mutation

Status: Amended by ADR 0018 and ADR 0020.

## Context

Effect RPC contracts do not classify operations as reads or writes. Requiring that classification
here would duplicate the contract.

## Decision

Every unary RPC leaf exposes `queryOptions` and `mutationOptions`. The call site chooses the TanStack
semantics. Leaves expose no direct execution helper.

## Consequences

ADR 0018 adds infinite queries to unary leaves. ADR 0020 supersedes this decision's omission of
streaming leaves.
