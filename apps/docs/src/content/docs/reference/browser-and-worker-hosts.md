---
title: Browser and Worker Hosts
description: Ready-client ownership in browsers and dedicated workers, and the worker transport boundary.
---

You can use both factories in a browser window or dedicated worker. Give each host its own Effect client, runner, Scope, and QueryClient.

## Own the worker lifetime

Acquire the client inside the worker, then build the utilities there. Send data transfer objects or events to the window. Keep the client, runtime, utility tree, and cache in their owning host.

On shutdown, stop new work and cancel queries. Wait for local stream finalizers and accepted mutations. Clear private data and close the client Scope. Wait for the worker to acknowledge cleanup before terminating it. Keep other owners' caches and clients separate.

See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) and [cancellation](/effect-api-query/guides/cancellation/) for cleanup order and finalizers.

## Worker transport boundary

To send Effect RPC calls from a window to a worker over `postMessage`, configure a worker transport.

Use the protocols in `effect/rpc` and services in `effect/workers`. `RpcClient.layerProtocolWorker` needs `WorkerPlatform` and `Spawner`. The server protocol needs `WorkerRunnerPlatform`. Supply a browser-compatible implementation and manage acquisition, interruption, and disposal. Pass the acquired client to the factory.
