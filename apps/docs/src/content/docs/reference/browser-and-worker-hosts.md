---
title: Browser and Worker Hosts
description: Ready-client ownership in browsers and dedicated workers, and the worker transport boundary.
---

Use the same factories and TanStack Query Core options in a browser window or dedicated worker.
Each host acquires its own ready clients and owns their `Scope`, runner, QueryClient, and disposal.

## Own the worker lifetime

Create a utility tree inside the worker after acquiring its ready client. Run queries and maintain
their QueryClient in that worker. Messages to the window may carry application DTOs or events;
the utility tree, client, Effect runtime, and QueryClient remain owned by their host.

On shutdown, stop accepting work, cancel the owner's queries, and await the application's active
stream finalizers and accepted mutations before clearing private cache data and closing the
client's `Scope`. Native query cancellation can settle before asynchronous finalizers finish.
Wait for application-owned cleanup acknowledgements before terminating the worker. Disposing one
owner must not close another owner's clients or cancel its queries.

See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) and
[cancellation](/effect-api-query/guides/cancellation/) for the shared ownership contract.

## Worker transport boundary

A worker can own its ready client and QueryClient. Sending Effect RPC requests from a window to
a worker over `postMessage` requires a separate transport integration.

Effect exposes worker protocols through `effect/rpc` and worker services through `effect/workers`.
`RpcClient.layerProtocolWorker` requires application-supplied `WorkerPlatform` and `Spawner`
services. The server's worker protocol requires `WorkerRunnerPlatform`. The package supplies none
of these services and does not construct a worker transport. A browser worker transport needs a
compatible platform integration and its own acquisition, interruption, and disposal contract.
Supplying an already acquired client preserves the factories' existing ready-client boundary.
