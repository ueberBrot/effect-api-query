# Generate accumulated and live stream queries

Status: Accepted. Partially supersedes ADR 0002 and ADR 0003. Extended to HTTP SSE views by
[ADR 0024](0024-project-http-streams-and-buffered-metadata.md).

Streams support two cached representations: ordered accumulated history and the latest live value.
Keep these representations separate, and include retention and refetch policies in accumulated
cache identity, because incompatible histories cannot safely share an entry. Broad key prefixes
still support invalidation across views and policies.

The adapter consumes caller-owned ready clients and follows TanStack cancellation while preserving
complete Effect failures. Applications own transport, reconnection, and resource lifetime; server
rendering must settle and stop open work before disposing those resources. Live values follow
[ADR 0012](0012-normalize-undefined-query-success-to-null.md), while accumulated elements retain
their decoded representation.
