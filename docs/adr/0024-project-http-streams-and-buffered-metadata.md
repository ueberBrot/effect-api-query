# Project HTTP streams and buffered metadata into separate cached views

Status: Accepted. Amends [ADR 0020](0020-generate-accumulated-and-live-stream-queries.md)
and [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

Query caches hold decoded application values. HTTP responses and streams retain transport
resources. Generate accumulated and live views for unambiguous SSE successes. Generate an opt-in
buffered metadata view with decoded data, status, and a plain header snapshot. Give each
representation separate cache identity so incompatible data shapes cannot share an entry.

Preserve declared decoded header wrappers. Omit mixed buffered/streamed successes because they lack
one accurate view. Omit raw byte streams because their chunk boundaries depend on the transport.
Applications own download sinks, reconnection, resume policy, and client lifetime. The adapter
consumes their ready clients without caching transport resources.
