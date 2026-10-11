# Use public decoded-message clients for server-local RPC

Status: Accepted. Extends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md)
and [ADR 0019](0019-host-effect-rpc-inside-tanstack-start.md).

Server rendering can execute local handlers without a network round trip. Applications may
connect Effect's public decoded-message client and server within a request-owned Scope and pass
the ready client to the adapter. This preserves the lifecycle-neutral boundary without adding a
package-owned client factory or relying on test constructors.

Server-owned services determine request authority; caller execution services cannot override it.
Each request owns its connection and QueryClient, and browser execution owns separate resources.
Decoded-message execution skips transport Schema codecs, so applications requiring wire validation
or codec effects retain a schema-aware protocol. The exact Effect peer bounds this upstream API.
