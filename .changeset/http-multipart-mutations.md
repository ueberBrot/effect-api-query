---
'effect-api-query': minor
---

Expose mutation options and keys for HTTP endpoints with buffered multipart payloads. Uploads accept
FormData with the endpoint's decoded request parts and preserve decoded results, callbacks, and
Effect failure Causes. These endpoints have no query builders or key encoders; streaming multipart
requests and streaming responses remain omitted.

Previously omitted upload endpoints now participate in utility path validation and runner service
requirements. Supply a runner when their request, response, middleware, or ready client needs services.
