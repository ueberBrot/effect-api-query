---
title: Browser and Worker Hosts
description: Framework-free browser and dedicated worker coverage, ready-client ownership, and transport limits.
---

The package root executes generated RPC and HTTP operations in browser windows and dedicated
workers. Both hosts use the same factories and TanStack Query Core options. Each host acquires
its own ready clients and owns their `Scope`, runner, QueryClient, and disposal.

## Host and operation coverage

The current host matrix uses Effect 4.0.0, Query Core 5.103.1 and 5.104.0, and Playwright 1.63.0.
Chromium 153.0.8010.12 and Firefox 155.0 execute every operation below in both a window and a
dedicated worker.

| Operation or behavior      | RPC                                          | HTTP                                                                  |
| -------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Buffered reads and writes  | Generated unary queries and mutations        | Generated queries and mutations with native request/response encoding |
| Accumulated streamed query | Ordered values from a ready RPC client       | Decoded SSE values from a ready HTTP API client                       |
| Live query                 | Latest emitted value                         | Latest decoded SSE value                                              |
| Declared response headers  | Outside the RPC contract                     | Preserved decoded header wrappers                                     |
| Metadata view              | Outside the RPC contract                     | Decoded data, status, and immutable raw header snapshot               |
| Conditional query sentinel | Consumer Query Core `skipToken` binding      | Consumer Query Core `skipToken` binding                               |
| Independent cache owners   | Separate clients, prefixes, and QueryClients | Separate clients, prefixes, and QueryClients                          |
| Cancellation and disposal  | Stream finalization before client disposal   | Stream finalization before client disposal                            |

The RPC host coverage uses an in-process decoded-message ready client. HTTP coverage uses the
native in-process routing, response encoding, and client decoding pipeline, including SSE. These
hosts do not certify a network transport, browser authentication scheme, service worker, shared
worker, or cross-host cache protocol.

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

A worker hosting ready-client queries is distinct from a window sending Effect RPC requests to
a worker over `postMessage`. The latter is not certified by this matrix.

Effect exposes worker protocols through `effect/rpc` and worker services through `effect/workers`.
`RpcClient.layerProtocolWorker` requires application-supplied `WorkerPlatform` and `Spawner`
services. The server's worker protocol requires `WorkerRunnerPlatform`. The package supplies none
of these services and does not construct a worker transport. A browser worker transport needs a
compatible platform integration and its own acquisition, interruption, and disposal contract.
Supplying an already acquired client preserves the factories' existing ready-client boundary.
