# Keep RPC transport aggregation in the application

Status: Accepted. Extends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md).

Repeated RPC calls can incur substantial transport overhead. Keep transport selection and
aggregation in the application because they determine connection lifetime, latency, routing,
retries, and cancellation. Shared WebSocket transport reduces repeated headers while preserving
independent calls; explicit bulk RPCs remain a domain choice.

The utility tree adds no automatic transport batching. Backend request batching, transport
aggregation, and Query publication address different costs and retain separate ownership.
