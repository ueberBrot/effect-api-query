---
title: HTTP Utility Tree
description: Understand literal HTTP identifiers, top-level groups, and omitted endpoints.
---

`createHttpApiQueryUtils` builds a frozen object with methods for each supported endpoint. See [supported operations](/effect-api-query/getting-started/feature-support/) for the methods available for each response type, including streams and uploads.

| Declaration | Generated path |
| --- | --- |
| Group `users`, endpoint `get` | `http.users.get` |
| Group `user.accounts`, endpoint `get.user` | `http['user.accounts']['get.user']` |
| Top-level group `system`, endpoint `ping` | `http.ping` |

Use the group and endpoint names as written. If a name contains dots, use bracket access. The API identifier forms part of the cache prefix. Keep declaration identifiers literal so TypeScript can infer the paths.

Call `key()` on any retained branch or endpoint to select its cache entries. A top-level group's endpoints appear at the root. Use the declaration's group identifier in custom key encoders. The factory rejects unsafe names, collisions, and invalid encoders.

| Endpoint success/payload | Generated cache views |
| --- | --- |
| Buffered without multipart | Ordinary, infinite, and mutation builders, plus buffered metadata |
| Any buffered multipart payload alternative | Mutations only, including mixed plain and multipart alternatives |
| Single SSE or NDJSON success without multipart | Accumulated history and latest-value views |

SSE and NDJSON keep declared decoded response headers in each emitted value. SSE decoder options contribute to both stream keys. NDJSON uses the limits in the declaration. Accumulated keys also include retention and refetch settings. Use the endpoint prefix to match every policy. See [HTTP builders](/effect-api-query/reference/http-builders/) for exact keys and options.

The factory skips unsupported endpoints and groups with no supported endpoints. It rejects conflicting multipart metadata. For raw byte streams, use the ready client and manage byte sinks and reconnection in your app. See [compatibility and limits](/effect-api-query/reference/compatibility-and-limits/) for unsupported shapes.

Any buffered multipart alternative makes the endpoint mutation-only, regardless of HTTP method. Use `key()`, `mutationKey()`, or `mutationOptions()`. Mutation variables, including files, stay outside the key. The factory rejects a key encoder for these leaves. See [file uploads](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).

Ordinary builders return decoded data. A buffered metadata view also copies the status and raw headers. Request input excludes response controls. See the [HTTP factory](/effect-api-query/reference/http-factory/) for input and response rules, and [semantic keys](/effect-api-query/concepts/semantic-keys/) for the namespace.
