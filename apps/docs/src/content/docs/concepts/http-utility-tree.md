---
title: HTTP Utility Tree
description: Understand literal HTTP identifiers, top-level groups, and omitted endpoints.
---

`createHttpApiQueryUtils` builds and freezes an HTTP utility tree when you call it with a literal
Effect HttpApi declaration. Buffered endpoints without multipart have ordinary query, infinite-query,
and mutation builders. Buffered multipart endpoints have mutation builders only, regardless of HTTP method.
Endpoints with one SSE success expose accumulated streamed-query builders.

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

The factory retains a single SSE success, including a decoded response-header wrapper. Its leaf
exposes `key()`, `streamedKey()`, and `streamedOptions()`. Cache entries hold ordered decoded events;
header wrappers surround each event. Decoder, retention, and refetch policies contribute to concrete
identity while endpoint prefixes continue to select every view policy.

Raw byte streams, mixed buffered/SSE successes, SSE endpoints with multipart payloads, and streaming
multipart requests omit the complete endpoint. Groups containing only omitted endpoints disappear.
Contradictory multipart metadata causes factory construction to fail. Use the ready client directly
for unsupported streams; applications own byte sinks, reconnection, and resume policy.

Any buffered multipart payload alternative makes the endpoint mutation-only, including an endpoint
that also accepts ordinary payloads. Its leaf exposes `key()`, `mutationKey()`, and `mutationOptions()`.
Files and other mutation variables do not become cache identity, so these leaves require no key
encoder and reject encoder entries. See [upload a file](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).

Raw-response modes are also deferred. Generated calls force decoded-only responses and exclude
response controls from their input. See the [HTTP factory](/effect-api-query/reference/http-factory/)
for request, response, and builder contracts, and [Semantic Keys](/effect-api-query/concepts/semantic-keys/)
for the `http` namespace.

The [public HTTP type consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts)
and [factory runtime tests](https://github.com/ueberBrot/effect-api-query/blob/main/tests/create-http-api-query-utils.test.ts) check these projection rules.
