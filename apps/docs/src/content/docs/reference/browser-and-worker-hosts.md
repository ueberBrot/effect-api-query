---
title: Browser and Worker Hosts
description: Ready-client ownership in browsers and dedicated workers, and the worker transport boundary.
---

The factories and TanStack Query Core options work in browser windows and dedicated workers. Each host acquires its own ready clients and owns their `Scope`, runner, QueryClient, and disposal.

## Own the worker lifetime

A worker creates its utility tree after it acquires a ready client. Queries and their QueryClient run in that worker. Messages to the window can carry application DTOs or events. The utility tree, client, Effect runtime, and QueryClient remain owned by their host.

Shutdown stops new work and cancels the owner's queries. The application awaits active stream finalizers and accepted mutations before it clears private cache data and closes the client's `Scope`. Native query cancellation can settle before asynchronous finalizers finish. Worker termination requires acknowledgements that application-owned cleanup finished. Disposing one owner must not close another owner's clients or cancel its queries.

See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) and [cancellation](/effect-api-query/guides/cancellation/) for the shared ownership contract.

## Worker transport boundary

A worker can own its ready client and QueryClient. Effect RPC requests sent from a window to a worker over `postMessage` require a separate transport integration.

Effect exposes worker protocols through `effect/rpc` and worker services through `effect/workers`. `RpcClient.layerProtocolWorker` requires `WorkerPlatform` and `Spawner` services supplied by the application. The server's worker protocol requires `WorkerRunnerPlatform`. The package supplies none of these services and does not construct a worker transport. A browser worker transport needs a compatible platform integration with its own acquisition, interruption, and disposal contract. An already acquired client preserves the factories' ready-client boundary.
