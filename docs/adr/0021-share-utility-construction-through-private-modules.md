# Share utility construction through private modules

Status: Accepted. Clarifies ADR 0003, ADR 0005 through ADR 0007, and ADR 0009. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

One root package and artifact expose the public factories; core and adapters remain private.
The utility-tree module owns atomic validation, canonical keys, options, skipping, and unary
execution through operation descriptions. Shared Query Core types contain no protocol declarations.

Adapters own projection, Schema inspection, request preparation, ready-client invocation, request
options, mapped types, and errors. Preparation binds input to its key; later RPC pages only
construct payloads because they reuse the initial key. Streams retain their policy and cleanup.
This keeps cache behavior in shared modules and protocol-specific behavior in adapters without
changing public behavior. Tests exercise the public factories; public adapter registration and
subpath exports stay excluded.
