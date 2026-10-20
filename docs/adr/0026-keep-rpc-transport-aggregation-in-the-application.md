# Keep RPC transport aggregation in the application

Status: Accepted. Extends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md).

Repeated RPC calls can incur substantial transport overhead. Transport selection and aggregation determine connection lifetime, latency, routing, retries, and cancellation. Keep both in the application. Shared WebSocket transport reduces repeated headers and preserves independent calls. Explicit bulk RPCs remain a domain choice.

The utility tree adds no automatic transport batching. Backend request batching, transport aggregation, and Query publication address different costs and retain separate ownership.
