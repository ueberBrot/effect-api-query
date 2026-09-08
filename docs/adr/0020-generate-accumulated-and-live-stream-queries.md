# Generate accumulated and live stream queries

Status: Accepted. Partially supersedes ADR 0002 and ADR 0003.

Streaming RPC leaves expose `streamedKey`/`streamedOptions` for ordered history with `reset`,
`append`, and `replace` refetch modes, and `liveKey`/`liveOptions` for the latest value. A live stream
that completes without emitting a value raises `EffectRpcQueryEmptyStreamError`. Separate `streamed`
and `live` key segments prevent collisions with other query shapes and mutations; generated prefixes
support invalidation.

The ready RPC client remains the execution seam, including direct execution outside TanStack.
Client construction and Effect middleware remain interception seams. Stream functions forward
TanStack's abort signal, close the AsyncIterator on cancellation, and preserve the complete Cause.
The application owns client/runtime resources, transport, middleware, Scope, QueryClient, and
framework lifecycle. SSR dehydrates completed data normally; open streams require cancellation
after the first successful snapshot. Mutations have no cancellation signal.
