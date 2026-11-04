# Extend HTTP stream views to decoded NDJSON

Status: Accepted. Amends the SSE-only stream eligibility in [ADR 0024](0024-project-http-streams-and-buffered-metadata.md).

The ready HTTP API client supplies decoded NDJSON records, so the adapter can reuse its accumulated streamed query and live query views. Generate these views for exactly one SSE or NDJSON success, including declared decoded header wrappers.

Effect's ready client owns NDJSON framing, Schema decoding, declaration-level limits, and decoding services. Project its decoded records through the existing stream views. Preserve SSE decoder options and key fields; NDJSON accepts no SSE options and adds no SSE decoder identity. Both formats reuse retention, publication, recovery, snapshots, and iterator cleanup.

ADR 0024's buffered metadata, separate cache identities, endpoint exclusions, and application-owned resource lifetimes remain in effect. This amendment extends the supported decoded format without adding adapter-owned framing or transport resources.
