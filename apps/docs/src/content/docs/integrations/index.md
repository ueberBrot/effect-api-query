---
title: Integrations
description: Connect generated Core options to native framework, router, server-rendering, and transport APIs.
---

Pass generated options to your framework's TanStack Query hooks, a QueryClient, or a router loader. Start with the guide for your framework.

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

For provider and rendering details specific to your framework, use its TanStack Query documentation.

## Rebuild options at the reactive boundary

Acquire the Effect client and create the utility tree once per cache owner. If an input depends on state, call the builder during React render or inside the framework's computed value or accessor.

Keep [captured input](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) unchanged while options can run. Build new options with new input. Mutations receive fresh variables when they run. Rebuild mutation options if their callbacks or settings depend on state.

## Own the cache and client lifetime

Give the framework provider or router the QueryClient you use for the cache. Keep your Query wrapper and app on one resolved Query Core version. See [compatibility](/effect-api-query/reference/compatibility-and-limits/) for tested combinations.

Changing input or removing a component detaches its observer. An abort-aware stream can stop when the last ordinary observer leaves. The ready client determines whether the transport stops too. TanStack's Suspense hooks have their own cancellation limits.

Stop consumers and cancel queries before you release resources. Wait for local finalizers and accepted mutations, then clear the cache and release the client and runtime. See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) for cleanup and [switch cache owners](/effect-api-query/guides/switch-cache-owners/) for identity changes.

## Server rendering and hydration

Give each server request a fresh QueryClient and request-specific clients. Give the browser separate resources. Use equivalent inputs and prefixes to address the same keys on both sides.

To transfer ordinary data, see [hydrate unary data](/effect-api-query/guides/hydrate-unary-data/). For pages, metadata, and streams, use [view codecs](/effect-api-query/guides/hydrate-query-views/). Use a [stream snapshot](/effect-api-query/guides/stream-snapshots/) to wait for data and local cleanup before disposing of a request.

## Configure the client and host

Set up transport, authentication, and services before you pass the client to a factory. See [WebSocket clients](/effect-api-query/guides/websocket-clients/), [client lifecycle](/effect-api-query/concepts/client-lifecycle/), and [stream tracing](/effect-api-query/guides/trace-streams/).

For complete hosts and applications, [run the examples](/effect-api-query/examples/).
