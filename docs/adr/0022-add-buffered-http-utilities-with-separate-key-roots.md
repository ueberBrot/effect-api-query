# Add buffered HTTP utilities with separate key roots

Status: Accepted. Multipart support amended by [ADR 0023](0023-expose-buffered-multipart-http-mutations.md).
Streaming and metadata views extended by [ADR 0024](0024-project-http-streams-and-buffered-metadata.md).

Expose HTTP and RPC utilities through one package, sharing private construction while preserving
their distinct declaration and request contracts. HTTP utilities consume caller-owned ready clients
and project only response shapes they can represent truthfully.

HTTP cache roots include the adapter and API identity, so HTTP endpoints and RPC tags cannot collide
under a shared caller prefix. Applications still own identity partitions and deliberate invalidation
across adapters. Decoded header wrappers and complete Effect failures remain intact at the boundary.
