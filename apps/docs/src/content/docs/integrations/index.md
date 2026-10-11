---
title: Integrations
description: Connect generated Core options to native framework, router, server-rendering, and transport APIs.
---

`effect-api-query` produces static TanStack Query Core options. Use the native consumer that owns
your application: a framework hook, QueryClient, or router loader. The generated key, input,
query data, and Effect failure contract stay the same across these consumers.

## Connect a native consumer

| Integration                                                  | Adapter-specific guidance                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [React Query](/effect-api-query/guides/react-query/)         | Complete ready-client/provider setup, static options, and shared policies               |
| [Suspense](/effect-api-query/guides/suspense-and-recovery/)  | Boundary reset, cached refetch failures, parallel reads, and native cancellation limits |
| [Vue](/effect-api-query/guides/vue-query/)                   | Computed options, bounded hook inference, and Vue's `enabled` getter                    |
| [Solid](/effect-api-query/guides/solid-query/)               | Accessors and defined initial-data overloads                                            |
| [Svelte](/effect-api-query/guides/svelte-query/)             | Reactive accessors and Svelte declaration resolution                                    |
| [Angular](/effect-api-query/guides/angular-query/)           | Signal accessors, injection context, and skipped-query result types                     |
| [Router and Start](/effect-api-query/guides/tanstack-start/) | Shared loader/component options and independent SSR resources                           |

These pages explain how generated options participate in each native API. Use the framework's
own TanStack documentation for its provider, rendering, and reactive primitives.

## Rebuild options at the reactive boundary

Acquire the ready client and create its utility tree once for a cache owner. Call a builder inside
React render or the other framework's computed value/accessor when its input depends on reactive
state. Passing one previously built options object keeps the captured request attached to its
original input.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
while options can execute. The immutable key does not freeze arbitrary request values.
A new request needs new input and options. Mutation variables belong to each execution;
rebuild mutation options only when their callbacks or settings depend on reactive state.

## Own the cache and client lifetime

Provide the matching QueryClient through the native framework's provider or router context.
Match its Query wrapper to the application's Query Core version and use a compiler supported by
the framework tooling. The [compatibility reference](/effect-api-query/reference/compatibility-and-limits/)
records the tested combinations.

A changed input or removed component detaches its observer. An abort-aware open stream cancels
when its last ordinary observer leaves; another observer can keep it active. TanStack's Suspense
hooks retain their documented cancellation limitation. Transport interruption depends on the
ready client.

Stop consumers, cancel queries, await local finalizers and accepted mutations, then clear the cache
and release the client and runtime. Follow [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/)
for disposal and [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) when identity changes.
Native cancellation can settle before asynchronous iterator cleanup finishes.

## Server rendering and hydration

A server request owns a fresh QueryClient and request-specific clients. The browser owns separate
resources, while equivalent inputs and prefixes address equivalent cache entries. Choose codecs
that preserve the decoded values across dehydration, hydration, and later client refetches.

Use [Hydrate Query Data](/effect-api-query/guides/hydrate-unary-data/) for DTOs or Schema classes,
[Hydrate Query Views](/effect-api-query/guides/hydrate-query-views/) for pages, metadata, and stream
representations, and [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) to settle a finite
capture and local cleanup before disposing a request.

## Configure the client and host

Applications configure transport, authentication, middleware, runtime services, and telemetry
before passing a ready client to a factory. See
[WebSocket Clients](/effect-api-query/guides/websocket-clients/),
[Browser and Worker Hosts](/effect-api-query/reference/browser-and-worker-hosts/), and
[Stream Tracing](/effect-api-query/guides/trace-streams/).
[External HTTP Clients](/effect-api-query/reference/external-http-clients/) explains encoded OpenAPI
interop; those Promise clients do not replace the ready Effect HttpApiClient accepted by the factory.

For complete hosts and applications, [run the examples](/effect-api-query/examples/).
