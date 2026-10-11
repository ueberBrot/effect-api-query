---
title: Executable Examples
description: Run the repository's React Query and TanStack Start applications.
---

The repository contains two complete applications, each with separate RPC and HTTP views that
demonstrate both factories. They share contracts and handlers: Vite uses a separate host, while
Start serves its own routes. Both RPC endpoints accept request bodies up to 1 MiB and return
HTTP 413 for larger bodies.

| Example                                                                                           | Demonstrates                                                                                       | API host                                          | Application URL         |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------- |
| [Vite React](https://github.com/ueberBrot/effect-api-query/tree/main/examples/vite-react)         | RPC queries and streams beside buffered HTTP reads, writes, pagination, failures, and cancellation | Standalone server on port `3001`, proxied by Vite | `http://127.0.0.1:5173` |
| [TanStack Start](https://github.com/ueberBrot/effect-api-query/tree/main/examples/tanstack-start) | RPC and HTTP loaders, server rendering, hydration, navigation, mutations, and cancellation         | Same-origin `/rpc` and `/api/$` server routes     | `http://127.0.0.1:3000` |

## Set up locally

Clone the repository, then run commands from its root:

```sh
git clone https://github.com/ueberBrot/effect-api-query.git
cd effect-api-query
```

Install the Node version in `.node-version` and the pnpm version in `package.json`, then install
the workspace dependencies:

```sh
pnpm install --frozen-lockfile
```

The workspace includes Vite+. If `vp` is not on your shell's PATH, prefix the commands below with
`pnpm exec`, for example `pnpm exec vp run vite-react-dev`.

You can also use the included Dev Container: install Docker and the VS Code Dev Containers
extension, open the clone, and choose **Dev Containers: Reopen in Container**. The container
installs the declared tool versions and workspace dependencies, and forwards the application ports.

StackBlitz WebContainers cannot run these examples because Vite+ requires a native binding
that is unavailable there.

## Run Vite React

```sh
vp run vite-react-dev
```

This task starts the standalone server and the Vite development server. Vite proxies `/rpc`
and `/api` to the standalone host. The HTTP and RPC handlers share one user directory.
To use another HTTP host, set `VITE_HTTP_BASE_URL` to its origin, such as
`http://127.0.0.1:3001`; the contract already supplies `/api`. The application provides the
demo authorization header through its HTTP client middleware.

### Compare HTTP and RPC

| Try                                                           | Observable result                                                | Complete source                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Create/delete a user in either directory                      | Both adapters refresh through explicit cross-prefix invalidation | [application.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts)                     |
| Trigger a declared HTTP failure                               | HTTP execution metadata and preserved Cause                      | [http-section.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/http-section.tsx) |
| Start a slow query, wait for **Ready to cancel**, then cancel | Only that operation is interrupted; completed writes remain      | [cancellation guide](/effect-api-query/guides/cancellation/)                                                                             |
| Switch cache owner or reload                                  | Private caches retire; allowlisted directory DTOs may persist    | [owner-cache.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/owner-cache.ts)                     |

Copy [shared contracts](https://github.com/ueberBrot/effect-api-query/tree/main/examples/contracts/src),
[ready-client ownership](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts),
and [server handlers](https://github.com/ueberBrot/effect-api-query/tree/main/examples/server/src).
The application owns clients, runners, providers, cross-adapter invalidation and disposal.

## Run TanStack Start

```sh
vp run tanstack-start-dev
```

This task starts one full-stack process at `http://127.0.0.1:3000`, serving `/rpc` and `/api/$`.
Choose **HTTP users** for server-rendered data and hydrated navigation, or **HTTP SSR failure**
for browser refetch of a failure omitted from dehydration. Each request owns its cache and
clients; the browser owns separate resources.

Copy the [router](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/router.tsx),
[SSR codecs](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/query-ssr.ts),
and [failure route](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/routes/http-failure.tsx).
See [TanStack Start](/effect-api-query/guides/tanstack-start/) for the library integration.

## Pause a query until a user is selected

In either app's **Choose before fetching** panel, **No user selected** sends no lookup.
Select a user to fetch its summary; clear and reselect within 30 seconds to reuse the cache.
Skipped and active options retain the same `select` and `staleTime`.

## Compare full and bounded stream history

After diagnostics finish, **Replay newest 2** retains the latest two states; **Replay full history**
retains all four. The live view shows only the latest state. Each accumulated policy has its own
key. See [Choose Stream History](/effect-api-query/guides/choose-stream-history/).

## Inspect request-local metadata

**Trigger declared failure** supplies the request-local `x-request-source: diagnostics-panel`
RPC header while shared authorization stays on the client runner. See
[Request-local RPC Options](/effect-api-query/reference/generated-builders/#request-local-rpc-options).

## Build the examples

Build either application without starting it:

```sh
vp run vite-react-build
vp run tanstack-start-build
```
