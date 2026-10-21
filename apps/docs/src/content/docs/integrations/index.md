---
title: Integrations
description: Connect generated Core options to native framework, router, server-rendering, and transport APIs.
---

`effect-api-query` builds static TanStack Query Core options. Pass them to a native framework hook, QueryClient, or router loader in your application. Each consumer uses the same generated key, input, query data, and Effect failure contract.

## Connect a native consumer

| Integration | Adapter-specific guidance |
| --- | --- |
| [React Query](/effect-api-query/guides/react-query/) | Complete ready-client/provider setup, static options, and shared policies |
| [Suspense](/effect-api-query/guides/suspense-and-recovery/) | Boundary reset, cached refetch failures, parallel reads, and native cancellation limits |
| [Vue](/effect-api-query/guides/vue-query/) | Computed options, bounded hook inference, and Vue's `enabled` getter |
| [Solid](/effect-api-query/guides/solid-query/) | Accessors and defined initial-data overloads |
| [Svelte](/effect-api-query/guides/svelte-query/) | Reactive accessors and Svelte declaration resolution |
| [Angular](/effect-api-query/guides/angular-query/) | Signal accessors, injection context, and skipped-query result types |
| [Router and Start](/effect-api-query/guides/tanstack-start/) | Shared loader/component options and independent SSR resources |

Use the linked guides to connect generated options to each native API. For providers, rendering, and reactive primitives, use the framework's own TanStack documentation.

## Rebuild options at the reactive boundary

Acquire the ready client and create its utility tree once for a cache owner. If input depends on reactive state, call the builder during React render or inside the other framework's computed value or accessor. A previously built options object keeps the request tied to the input that it captured.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) while options can execute. The immutable key does not freeze arbitrary request values. A new request needs new input and options. Each mutation execution receives its own variables. Rebuild mutation options only when their callbacks or settings depend on reactive state.

## Own the cache and client lifetime

Provide the matching QueryClient through the native framework's provider or router context. Use a Query wrapper that matches the application's Query Core version. Use a compiler that the framework tooling supports. The [compatibility reference](/effect-api-query/reference/compatibility-and-limits/) lists the tested combinations.

A changed input or removed component detaches its observer. An abort-aware open stream cancels when its last ordinary observer leaves. Another observer can keep the stream active. TanStack's Suspense hooks retain their documented cancellation limitation. Transport interruption depends on the ready client.

Stop consumers and cancel queries. Wait for local finalizers and accepted mutations to finish. Then clear the cache and release the client and runtime. Follow [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for disposal and [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) when identity changes. Native cancellation can settle before asynchronous iterator cleanup finishes.

## Server rendering and hydration

Each server request owns a fresh QueryClient and request-specific clients. The browser owns separate resources. Equivalent inputs and prefixes address equivalent cache entries on both sides. Choose codecs that preserve decoded values during dehydration, hydration, and later client refetches.

Use [Hydrate Query Data](/effect-api-query/guides/hydrate-unary-data/) for DTOs or Schema classes, [Hydrate Query Views](/effect-api-query/guides/hydrate-query-views/) for pages, metadata, and stream representations, and [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) to settle a finite capture and local cleanup before disposing a request.

## Configure the client and host

Before passing a ready client to a factory, configure transport, authentication, middleware, runtime services, and telemetry. See [WebSocket Clients](/effect-api-query/guides/websocket-clients/), [Browser and Worker Hosts](/effect-api-query/reference/browser-and-worker-hosts/), and [Stream Tracing](/effect-api-query/guides/trace-streams/). [External HTTP Clients](/effect-api-query/reference/external-http-clients/) explains how to work with encoded OpenAPI clients. Those Promise clients do not replace the ready Effect HttpApiClient that the factory accepts.

For complete hosts and applications, [run the examples](/effect-api-query/examples/).
