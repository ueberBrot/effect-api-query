---
title: HTTP Utility Tree
description: Understand literal HTTP identifiers, top-level groups, and omitted endpoints.
---

`createHttpApiQueryUtils` builds and freezes an HTTP utility tree when you call it with a literal
Effect HttpApi declaration. Each endpoint in the tree has ordinary query, infinite-query, and
mutation builders, regardless of its HTTP method.

| Declaration                                | Generated path                      |
| ------------------------------------------ | ----------------------------------- |
| Group `users`, endpoint `get`              | `http.users.get`                    |
| Group `user.accounts`, endpoint `get.user` | `http['user.accounts']['get.user']` |
| Top-level group `system`, endpoint `ping`  | `http.ping`                         |

HTTP identifiers remain literal properties. They do not split on dots as RPC tags do. The API
identifier is part of the key namespace. Group and endpoint identifiers determine the path
through the tree. Keep declaration types literal so TypeScript preserves those paths and omissions.

Every retained branch and endpoint has `key()`. Top-level groups have no branch in the tree, but
custom key encoders still use their declaration group identifier. The factory rejects unsafe
names, collisions, and invalid encoder configuration before returning any utilities.

The factory omits an entire endpoint if any success alternative streams, including a stream
wrapped with response headers, or any request alternative is multipart. It also omits groups
containing only omitted endpoints. It never keeps just the buffered alternatives of a partially
supported endpoint. Contradictory multipart metadata causes factory construction to fail. HTTP
streams and multipart uploads remain deferred; use the ready client directly when you need them.

Raw-response modes are also deferred. Generated calls force decoded-only responses and exclude
response controls from their input. See the [HTTP factory](/effect-api-query/reference/http-factory/)
for request, response, and builder contracts, and [Semantic Keys](/effect-api-query/concepts/semantic-keys/)
for the `http` namespace.

The [public HTTP type consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts)
and [factory runtime tests](https://github.com/ueberBrot/effect-api-query/blob/main/tests/create-http-api-query-utils.test.ts) check these projection rules.
