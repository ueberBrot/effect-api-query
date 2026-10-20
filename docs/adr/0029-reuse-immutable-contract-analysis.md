# Reuse immutable contract analysis across utility trees

Status: Accepted. Clarifies [ADR 0009](0009-build-an-eager-frozen-utility-tree.md) and [ADR 0021](0021-share-utility-construction-through-private-modules.md).

Reuse schema encoders and request analysis for immutable Effect declarations. Each factory call still validates its configuration and eagerly builds a frozen tree bound to its own ready client, runner, key prefix, and custom encoders. Declaration caches retain no application resources. Failed suspended-schema inspection remains retryable.

Caching complete utility trees would conflate request ownership and execution configuration. Keeping the cache below that boundary preserves independent owners while avoiding repeated analysis of the same contract.
