---
title: Inputs and Query Data
description: Use RPC payload defaults and decoded HTTP inputs, and understand which results become null.
---

## Query-stable RPC payloads

An RPC query with a payload constructs it to build the key. The client constructs it again when it runs the request. Use a query-stable Schema so the second construction preserves the encoded meaning of the first.

For example, an omitted locale and an explicit `"en"` share a cache entry if the constructor defaults to `"en"`. Use explicit values for time-dependent or random defaults. Custom key encoders receive the payload after construction.

If a constructor increments `id`, input `1` can build a key for `2` and send a request for `3`. Use a stable input Schema and do the conversion in the handler. A prepared input or key encoder cannot change how the client constructs the payload. Mutations pass the original input to the client, which constructs it once.

## Decoded HTTP inputs

Supply the decoded values for the endpoint's declared `params`, `query`, `headers`, and `payload`. Pass any needed defaults explicitly. Key preparation and the ready HttpApiClient encode the request parts separately.

Supply each declared request object even if all its fields are optional. For a query with no filters, pass `input: { query: {} }`.

## Keep captured inputs unchanged

Query options keep the request input for execution and retries. If the input changes, create new values and rebuild the options. A changed value can send a different request under the old key.

The factory freezes the encoded key. Nested values in the input can still be mutable. In a reactive framework, build new options inside the computed value or accessor.

`prepareInput(leaf, input)` reuses the prepared request and its frozen key payload. Keep the retained input unchanged. Pass the handle to the same leaf or a configured copy of that leaf. Other leaves and trees reject it. To move data from server to browser, use a [hydration codec](/effect-api-query/guides/hydrate-query-views/) and prepare fresh input on the browser.

`queryKey`, `queryOptions`, and `prepareInput` throw synchronously if construction or key encoding fails. An RPC constructor failure uses `PayloadConstructionFailed`. See [errors](/effect-api-query/reference/errors/) for key errors and the Effect Cause returned by failed execution.

## No-content and undefined query results

A buffered query that succeeds with `undefined` resolves to `null` because TanStack Query requires a value. The exported `QueryData<A>` type reflects that conversion.

An endpoint with `HttpApiSchema.NoContent` or `success: []` decodes a 204 response to `undefined`. Its ordinary and infinite queries cache `null`. The metadata view contains `data: null`.

Mutations keep the original success type. A mutation that succeeds with `undefined` still resolves to `undefined`.

A live query converts each `undefined` emission to `null`. That type also applies to its keys, selectors, and `initialData`. The first value makes the query successful while the stream keeps fetching. If a stream ends before its first value, RPC raises `EffectRpcQueryEmptyStreamError`. HTTP SSE and NDJSON raise `EffectHttpApiQueryEmptyStreamError`.

Accumulated streamed queries retain each emitted value as supplied. Their cached arrays can contain `undefined` elements.
