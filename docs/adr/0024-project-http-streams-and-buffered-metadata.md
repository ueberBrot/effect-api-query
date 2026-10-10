# Project HTTP streams and buffered metadata into separate cached views

Status: Accepted. Amends [ADR 0020](0020-generate-accumulated-and-live-stream-queries.md)
and [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

Query caches hold decoded application values, while HTTP responses and streams retain transport
resources. Generate accumulated and live views for unambiguous SSE successes, and an opt-in
buffered metadata view containing decoded data, status, and a plain header snapshot. Give each
representation separate cache identity so incompatible data shapes cannot share an entry.

Preserve declared decoded header wrappers. Omit mixed buffered/streamed successes and raw byte
streams: the former lack one truthful view, and the latter have transport-dependent chunk
boundaries. Applications own download sinks, reconnection, resume policy, and client lifetime;
the adapter consumes their ready clients without caching transport resources.
