---
title: Executable Examples
description: Run the repository's React Query and TanStack Start applications.
---

The repository contains two complete applications. Both use the same contracts and Effect RPC
handler implementation, but each hosts HTTP differently. Both RPC endpoints accept request bodies
up to 1 MiB and return HTTP 413 for larger bodies.

| Example                                                                                           | Demonstrates                                                                                       | RPC host                                          | Application URL         |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------- |
| [Vite React](https://github.com/ueberBrot/effect-rpc-query/tree/main/examples/vite-react)         | RPC queries and streams beside buffered HTTP reads, writes, pagination, failures, and cancellation | Standalone server on port `3001`, proxied by Vite | `http://127.0.0.1:5173` |
| [TanStack Start](https://github.com/ueberBrot/effect-rpc-query/tree/main/examples/tanstack-start) | RPC operation kinds in loaders, server rendering, dehydration, hydration, and client navigation    | Same-origin `POST /rpc` server route              | `http://127.0.0.1:3000` |

## Set up locally

Clone the repository, then run commands from its root:

```sh
git clone https://github.com/ueberBrot/effect-rpc-query.git
cd effect-rpc-query
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

The HTTP panel uses `createHttpApiQueryUtils` from `effect-api-query`; the existing RPC panels
use `createRpcQueryUtils` from the same package root. The application owns both ready clients,
their runners, and the QueryClient. Its disposal cancels queries before releasing client resources.

Use the HTTP directory to read users, load another page, and create or delete a user. Each write
explicitly invalidates both generated user prefixes, so the RPC directory reflects HTTP writes
and the HTTP directory reflects RPC writes. The two adapters retain separate cache keys.
**Reset directory** restores the deterministic shared data.

The HTTP user selector passes `skipToken` until a user is selected. HTTP request inputs use
structured decoded parts such as `params`, `query`, and `payload`; RPC inputs retain their
payload-constructor defaults. Deleting a user demonstrates an HTTP no-content mutation whose
result remains `undefined`.

Trigger the HTTP failure to inspect `EffectHttpApiQueryError` and its preserved `Cause`.
The package adds declaration identifiers to error metadata; upstream Causes can still contain
request, response, or schema issue values.

Choose **Start slow HTTP query**, wait for **HTTP: Ready to cancel**, then choose
**Cancel HTTP query**. The
example observes server interruption for that operation after the HTTP request is aborted. Each
panel owns a distinct operation ID, so cancelling an RPC query leaves a concurrent HTTP query
running. This cancels observation
and work in this handler; it does not compensate completed mutations. The RPC cancellable-command
panel continues to demonstrate explicit domain cancellation.

The executable sources are
[application ownership](https://github.com/ueberBrot/effect-rpc-query/blob/main/examples/vite-react/src/lib/application.ts),
[HTTP contracts](https://github.com/ueberBrot/effect-rpc-query/tree/main/examples/contracts/src), and
[server handlers](https://github.com/ueberBrot/effect-rpc-query/tree/main/examples/server/src).
The application is type-checked against the public package root and exercised through the real
server and browser suites.

## Run TanStack Start

```sh
vp run tanstack-start-dev
```

This task starts one full-stack process. The browser and server-rendering client both call the
Start-owned `/rpc` route.

Server rendering uses `http://127.0.0.1:3000/rpc`. If the Start server listens elsewhere, set the
server-only `EXAMPLE_RPC_ORIGIN` environment variable to its HTTP(S) origin, without a path,
credentials, query, or fragment. The browser uses the relative `/rpc` endpoint.

## Pause a query until a user is selected

In either application, find **Choose before fetching**. With **No user selected**, the generated
query uses `{ input: skipToken }` and sends no lookup request. Select **User 2: Edsger Dijkstra** to
load the user summary, then clear and reselect it within 30 seconds to reuse the cached result.

Both branches preserve the same `select` and `staleTime` options. The example uses ordinary
`useQuery`; the TanStack Start loader leaves this interactive query paused during server rendering.

## Compare full and bounded stream history

In either application, let the diagnostic stream finish, then choose **Replay newest 2**.
The accumulated history retains only “Workspace synchronized” and “Ready”; earlier updates disappear
as new ones arrive. Choose **Replay full history** to retain all four states again. The live query
continues to show only “Ready”.

The bounded replay supplies `maxChunks: 2` to `streamedOptions`. Both controls reuse the generated
streamed key: the bound changes retention policy, not RPC identity. The application keeps the selected
policy for subsequent refetches. TanStack Start also demonstrates this after hydrating its server snapshot.

## Inspect request-local metadata

In either application's diagnostics panel, choose **Trigger declared failure**. Its generated
mutation options supply the `x-request-source: diagnostics-panel` RPC header. Application-wide
authorization still comes from the shared client runner. The same `rpcOptions` input works with
queries, infinite queries, and both stream builders; see
[Generated Builders](/effect-rpc-query/reference/generated-builders/#request-local-rpc-options).

## Build the examples

Build either application without starting it:

```sh
vp run vite-react-build
vp run tanstack-start-build
```

## Run in a local environment

Run either example locally or in the Dev Container. StackBlitz WebContainers cannot run these
examples because Vite+ requires a native binding that is unavailable there.
