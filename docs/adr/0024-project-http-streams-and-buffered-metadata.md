# Project HTTP streams and buffered metadata into separate cached views

Status: Accepted. Amends [ADR 0020](0020-generate-accumulated-and-live-stream-queries.md) and [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

Query caches hold decoded application values. HTTP responses and streams retain transport resources. Generate accumulated and live views for exactly one SSE or NDJSON success. Generate an opt-in buffered metadata view with decoded data, status, and a plain header snapshot. Give each representation separate cache identity so incompatible data shapes cannot share an entry.

Effect's ready client owns NDJSON framing, Schema decoding, declaration-level limits, and decoding services. Project its decoded records through the existing stream views. Preserve SSE decoder options and key fields; NDJSON accepts no SSE options and adds no SSE decoder identity. Both formats reuse retention, publication, recovery, snapshots, and iterator cleanup.

Preserve declared decoded header wrappers. Omit mixed buffered/streamed successes because they lack one accurate view. Omit raw byte streams because their chunk boundaries depend on the transport. Applications own download sinks, reconnection, resume policy, and client lifetime. The adapter consumes their ready clients without caching transport resources.
