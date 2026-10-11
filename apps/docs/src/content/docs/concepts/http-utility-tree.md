---
title: HTTP Utility Tree
description: Understand literal HTTP identifiers, top-level groups, and omitted endpoints.
---

`createHttpApiQueryUtils` builds and freezes an HTTP utility tree from a literal Effect HttpApi
declaration. Buffered endpoints without multipart expose ordinary query, infinite-query, and
mutation builders. Buffered multipart endpoints expose mutation builders only, regardless of HTTP
method. Endpoints with one SSE success expose builders for accumulated streamed queries and live queries.

| Declaration                                | Generated path                      |
| ------------------------------------------ | ----------------------------------- |
| Group `users`, endpoint `get`              | `http.users.get`                    |
| Group `user.accounts`, endpoint `get.user` | `http['user.accounts']['get.user']` |
| Top-level group `system`, endpoint `ping`  | `http.ping`                         |

HTTP identifiers remain literal properties. Unlike RPC tags, they do not split on dots.
The API identifier is part of the key namespace. Group and endpoint identifiers determine the path
through the tree. Literal declaration types let TypeScript preserve those paths and omissions.

Every retained branch and endpoint has `key()`. A top-level group has no branch in the tree.
Custom key encoders still use that group's declaration identifier. The factory rejects unsafe
names, collisions, and invalid encoder configuration before it returns any utilities.

| Endpoint success/payload                   | Generated cache views                                             |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Buffered without multipart                 | Ordinary, infinite, and mutation builders, plus buffered metadata |
| Any buffered multipart payload alternative | Mutations only, including mixed plain and multipart alternatives  |
| Single SSE success without multipart       | Accumulated history and latest-value views                        |

SSE events retain decoded response-header wrappers. Decoder policy contributes to both view keys.
Accumulated keys also include retention and refetch policy. Endpoint prefixes select all policies.
The [HTTP Factory](/effect-api-query/reference/http-factory/) lists the exact builders.

The factory omits endpoints with raw byte streams, mixed buffered and SSE successes, multipart SSE
payloads, or streaming multipart requests. Groups with only omitted endpoints disappear.
Contradictory multipart metadata causes factory construction to fail. Unsupported streams require
direct use of the ready client. Applications own byte sinks, reconnection, and resume policy.

Any buffered multipart payload alternative makes an endpoint mutation-only, even if the endpoint
also accepts ordinary payloads. Its leaf exposes `key()`, `mutationKey()`, and `mutationOptions()`.
Files and other mutation variables do not contribute to cache identity. These leaves require no key
encoder and reject encoder entries. The [file upload guide](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file)
shows how to supply multipart input.

Raw response objects remain omitted. Ordinary queries, mutations, and SSE views use decoded-only
responses. Buffered metadata views copy status and headers alongside decoded data.
Request input excludes response controls. The [HTTP factory](/effect-api-query/reference/http-factory/)
defines request, response, and builder contracts. [Semantic Keys](/effect-api-query/concepts/semantic-keys/)
explains the `http` namespace.
