# Add buffered HTTP utilities with separate key roots

Status: Accepted. Multipart support amended by [ADR 0023](0023-expose-buffered-multipart-http-mutations.md). Streaming and metadata views extended by [ADR 0024](0024-project-http-streams-and-buffered-metadata.md).

Expose HTTP and RPC utilities through one package. Share private construction and preserve each adapter's declaration and request contracts. HTTP utilities consume caller-owned ready clients and project only response shapes that they can represent accurately.

HTTP cache roots include the adapter and API identity. HTTP endpoints and RPC tags therefore cannot collide under a shared caller prefix. Applications still own identity partitions and deliberate invalidation across adapters. The boundary preserves decoded header wrappers and complete Effect failures.
