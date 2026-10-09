# Generate accumulated and live stream queries

Status: Accepted. Partially supersedes ADR 0002 and ADR 0003. Extended to HTTP SSE views by
[ADR 0024](0024-project-http-streams-and-buffered-metadata.md).

Streaming RPC leaves expose `streamedKey`/`streamedOptions` for ordered history with `reset`,
`append`, and `replace` refetch modes, and `liveKey`/`liveOptions` for the latest value. A live stream
that completes without emitting a value raises `EffectRpcQueryEmptyStreamError`. Separate `streamed`
and `live` key segments prevent collisions with other query shapes and mutations; generated prefixes
support invalidation.

Concrete accumulated-stream identity includes the normalized retention bound and refetch mode,
so incompatible histories occupy separate cache entries. Omitted bounds mean unlimited retention;
omitted refetch mode means reset. Exact key builders accept the same policy as options builders,
and explicit defaults share identity with omitted defaults. Broad prefixes remain stable; persisted
accumulated histories require a version change when adopting this identity.

Live emissions normalize `undefined` to `null` under
[ADR 0012](0012-normalize-undefined-query-success-to-null.md); accumulated elements remain
unchanged. On an initial fetch, the first emission makes either view successful while the open
stream remains fetching. Live completion preserves the latest normalized value.

The ready RPC client remains the execution seam, including direct execution outside TanStack.
Client construction and Effect middleware remain interception seams. Stream functions forward
TanStack's abort signal and close the AsyncIterator on cancellation. A stream failure preserves its
complete Cause in `EffectRpcQueryError`, including interruption-only and mixed interruption/defect
Causes, while that signal is not aborted. Requested cancellation retains TanStack's native result
and cache reversion, including superseded refetches and removal of the last observer.
The application owns client/runtime resources, transport, middleware, Scope, QueryClient, and
framework lifecycle. SSR dehydrates completed data normally; open streams require cancellation
after the first successful snapshot. Mutations have no cancellation signal.
