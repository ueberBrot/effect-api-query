# Use public decoded-message clients for server-local RPC

Status: Accepted. Extends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md) and [ADR 0019](0019-host-effect-rpc-inside-tanstack-start.md).

Server rendering can execute local handlers without a network round trip. Applications can connect Effect's public decoded-message client and server within a request-owned Scope, then pass the ready client to the adapter. This preserves the lifecycle-neutral boundary. It requires neither a package-owned client factory nor test constructors.

Server-owned services determine request authority. Caller execution services cannot override that authority. Each request owns its connection and QueryClient. Browser execution owns separate resources. Decoded-message execution skips transport Schema codecs. If wire validation or codec effects are required, applications retain a schema-aware protocol. The exact Effect peer bounds this upstream API.
