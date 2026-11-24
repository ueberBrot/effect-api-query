---
title: Executable Examples
description: Run the repository's React Query and TanStack Start applications.
---

Run Vite React for a browser app with a separate API server. Run TanStack Start for server rendering and hydration. Both use the same RPC and HTTP contracts and handlers. The RPC routes reject bodies larger than 1 MiB with HTTP 413.

| Example | Demonstrates | API host | Application URL |
| --- | --- | --- | --- |
| [Vite React](https://github.com/ueberBrot/effect-api-query/tree/main/examples/vite-react) | RPC queries and streams beside buffered HTTP reads, writes, pagination, failures, and cancellation | Standalone server on port `3001`, proxied by Vite | `http://127.0.0.1:5173` |
| [TanStack Start](https://github.com/ueberBrot/effect-api-query/tree/main/examples/tanstack-start) | RPC and HTTP loaders, server rendering, hydration, navigation, mutations, and cancellation | Same-origin `/rpc` and `/api/$` server routes | `http://127.0.0.1:3000` |

For individual features such as uploads or replay, see the [HTTP workflow screens](/effect-api-query/examples/http-workflows/).

## Set up locally

Clone the repository and open its root directory.

```sh
git clone https://github.com/ueberBrot/effect-api-query.git
cd effect-api-query
```

Install the Node version from `.node-version` and the pnpm version from `package.json`. Install workspace dependencies from the repository root.

```sh
pnpm install --frozen-lockfile
```

If your shell cannot find `vp`, prefix it with `pnpm exec`. For example, run `pnpm exec vp run vite-react-dev`.

To use the Dev Container, install Docker and the VS Code Dev Containers extension. Open the repository and choose "Dev Containers: Reopen in Container". The container installs dependencies and forwards app ports.

StackBlitz WebContainers lack the native binding that Vite+ needs to run these examples.

## Run Vite React

```sh
vp run vite-react-dev
```

Vite starts the development server and proxies `/rpc` and `/api` to the standalone API. Both adapters share a user directory. For reads from another HTTP host, set `VITE_HTTP_BASE_URL` to its origin. The contract adds `/api`. Browser write access and cancellable operations use the same-origin proxy. The apps acquire an unprivileged operation session on load. Reload to renew a valid session or start a fresh session after it expires.

### Compare HTTP and RPC

| Try | Observable result | Complete source |
| --- | --- | --- |
| Create/delete a user in either directory | Both adapters refresh through explicit cross-prefix invalidation | [application.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts) |
| Trigger a declared HTTP failure | HTTP execution metadata and preserved Cause | [http-section.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/http-section.tsx) |
| Start a slow query, wait for "Ready to cancel", then cancel | Only that operation is interrupted. Completed writes remain. | [Cancellation](/effect-api-query/guides/cancellation/) |
| Switch cache owner or reload | Private caches retire. Allowlisted directory DTOs can persist. | [owner-cache.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/owner-cache.ts) |

See the [shared contracts](https://github.com/ueberBrot/effect-api-query/tree/main/examples/contracts/src), [browser setup](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts), and [server handlers](https://github.com/ueberBrot/effect-api-query/tree/main/examples/server/src) to adapt the example.

## Run TanStack Start

```sh
vp run tanstack-start-dev
```

Open `http://127.0.0.1:3000`. Choose "HTTP users" to see server-rendered data and navigation after hydration. Choose "HTTP SSR failure" to see the browser refetch a failed read that the server omitted. Each request and the browser use separate clients and caches.

See the [router](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/router.tsx), [hydration codecs](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/query-ssr.ts), and [failure route](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/routes/http-failure.tsx). The [Start guide](/effect-api-query/guides/tanstack-start/) explains the integration.

## Enable demo writes

To try user deletion or change the shared workflow document and readings, set `EXAMPLE_WRITE_TOKEN` to a private random value before starting the server. Open **Demo write access** in the app and enter the token. The browser receives a one-hour session cookie. Use the app and API on the same origin, through the Vite proxy or the Start host.

## Try cancellable commands

In "Cancellable commands", start two commands and cancel one. The other continues. See [cancellable commands](/effect-api-query/examples/cancellable-commands/) for the command protocol.

## Pause a query until a user is selected

In "Choose before fetching", select a user to load its summary. "No user selected" pauses the query. Clear and reselect the same user within 30 seconds to reuse its cached result.

## Compare full and bounded stream history

When diagnostics finish, choose "Replay newest 2" or "Replay full history". The first keeps two states and the second keeps all four. The live view keeps the latest state. See [stream history](/effect-api-query/guides/choose-stream-history/) for how each policy changes the key.

## Inspect request-local metadata

"Trigger declared failure" sends `x-request-source: diagnostics-panel` on that RPC request. See [request-local RPC options](/effect-api-query/reference/generated-builders/#request-local-rpc-options).

## Build the examples

Run either build command from the repository root.

```sh
vp run vite-react-build
vp run tanstack-start-build
```
