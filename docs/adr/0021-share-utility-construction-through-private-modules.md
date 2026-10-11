# Share utility construction through private modules

Status: Accepted. Clarifies ADR 0003, ADR 0005 through ADR 0007, and ADR 0009. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md) and [ADR 0023](0023-expose-buffered-multipart-http-mutations.md).

Share validation, canonical keys, options, and execution through private core modules. Adapters
own their protocol declarations, request preparation, ready-client invocation, and errors. Shared
Query Core contracts remain independent of protocol declarations.

This boundary gives common cache behavior one implementation while preserving each adapter's
input and execution semantics. Consumers use public factories from one root package; internal
modules and adapter registration remain private.
