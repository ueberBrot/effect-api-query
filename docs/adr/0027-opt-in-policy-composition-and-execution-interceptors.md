# Opt in to callback composition and execution interception

Status: Accepted. Partially supersedes [ADR 0004](0004-build-core-shaped-options-and-certify-react-first.md) only where it requires shared mutation callbacks to be replaced by local callbacks. The public configuration interface is superseded by [ADR 0032](0032-configure-utility-trees-and-require-stream-retention.md).

Keep replacement as the default. An explicit composition policy awaits shared mutation callbacks before local callbacks, while leaving optimistic context local. Required execution behavior belongs in a typed interceptor around the generated function. Interceptors preserve generated identity, skipped queries, native retries, and query cancellation. Each execution attempt permits at most one call to the underlying function.

This keeps existing builders and native callback inference while allowing reusable behavior that local callbacks cannot accidentally replace. Callback failures retain native mutation handling.
