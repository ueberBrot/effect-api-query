# Configure utility trees and require stream retention

Status: Accepted. Partially supersedes ADRs 0004, 0020, 0027, and 0031 for configuration, retained history, and published key payload types.

## Context

Applications share policies and execution behavior across groups of operations. A single configuration interface can express tree, branch, and leaf settings while retaining typed leaf callbacks. Accumulated streams also need an explicit choice between a recent history and retaining every emission.

## Decision

Expose `configureUtils` for generated utility trees, branches, and leaves. Each view accepts policies and ordered interceptors. Mutations also select callback replacement or composition. Named children receive more specific settings through `scoped`. Remove the separate public policy, interceptor, and leaf-configuration helpers.

Apply defaults from QueryClient to configured tree, branch, leaf, and call site. Leaf callbacks retain their data, error, and variable types. Shared tree and branch policy callbacks receive unknown contract-dependent values. Keep input, selection, initial data, pagination, and optimistic context local. Required execution behavior belongs in an interceptor. Interceptors run from broad to specific, with the first entry outermost, and may call their continuation once per attempt.

Mutation callbacks replace corresponding broader callbacks by default. A scope may compose shared callbacks before more specific callbacks. Keep `onMutate` local and preserve native callback failure handling.

Require a positive safe integer `maxChunks` bound or the literal `"unbounded"` on raw accumulated options and keys. Configured utilities may supply retention and publication policy once for their descendants. Their key and options builders inherit the same policy. Preserve immediate first publication and the existing refetch, cancellation, and cleanup contracts.

Publish canonical key payload slots as unknown values. Retain exact prefixes and view discriminators, plus typed data and error tags. Runtime key values remain validated immutable JSON. Applications use generated builders for exact keys and explicit projections for partial filters. Equivalent inputs and policies keep their runtime key identity.

## Consequences

Callers migrate removed helper imports to `configureUtils` and choose accumulated retention explicitly. Native framework consumers keep their own providers and reactive accessors. Complete Effect Causes, prepared-input ownership, ready-client lifetime, and application-owned transport remain unchanged.
