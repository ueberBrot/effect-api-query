---
title: HTTP Workflows
description: Try typed writes, streams, uploads, cache sharing, and event recovery.
---

After [workspace setup](/effect-api-query/examples/#set-up-locally), run:

```sh
vp run vite-react-dev
```

Open `http://127.0.0.1:5173` and choose a screen from the navigation.

For TanStack Start, run `vp run tanstack-start-dev` and open `http://127.0.0.1:3000/workflows`. Both apps use the same workflow components and native Query provider. Start acquires the workflow owner in the browser; its SSR request owner remains separate. Leaving the route drains the workflow before releasing its runtime.

| Screen | Try | Source |
| --- | --- | --- |
| First read and write | Write a title and seed the exact document query key. | [document.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/document.tsx) |
| HTTP metadata and ETags | Submit a title containing `blocked` for a typed error. Remember a revision, save a new title, then try the remembered revision for HTTP 412. | [document.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/document.tsx) |
| HTTP streaming | Switch between SSE and NDJSON; compare bounded history with the 250 ms coalesced live view, then stop both queries. | [streams.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/streams.tsx) |
| Multipart upload | Submit a nonempty file up to 64 KiB. The client validates selections; the server independently enforces HTTP 413 limits. | [upload.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/upload.tsx) |
| Decoded-value sharing | Refetch equal readings to see reference reuse. Change rooms to try prepared inputs and projected invalidation. | [readings.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/readings.tsx), [sharing.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/sharing.ts) |
| Event recovery | Resume after a disconnect, refresh after a sequence gap, or refresh expired replay. Notifications refresh the document query. Stop interrupts consumption and retry backoff. | [events.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/events.tsx), [recovery.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/recovery.ts) |

## Adapt an example

Start with the [contracts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/contracts/src/workflows.ts), [handlers](https://github.com/ueberBrot/effect-api-query/blob/main/examples/server/src/workflow-handlers.ts), and [client setup](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/application.ts). The setup acquires a query owner and binds a typed policy map with execution interceptors. Unmount consumers before awaiting disposal; it cancels reads, stops event consumers, and drains accepted mutations before releasing the runtime.

- Send response ETags unchanged and keep the server's atomic precondition check. See [HTTP Metadata](/effect-api-query/guides/http-metadata/).
- Keep shared cached values and dates immutable. See [Share Decoded Values](/effect-api-query/guides/share-decoded-values/).
- Recovery uses application-defined decimal string cursors and maps them to the server’s numeric replay position. `runQueryEvents` supplies the owner’s cache to `queryEffects`; accepted notifications invalidate the document, while gaps and expired replay refresh it. Define replay and gap policies for your server; the event scenarios use a finite demonstration feed. See [Reconnect Streams](/effect-api-query/guides/reconnect-streams/).
- Uploads use buffered mutations; byte-level progress and cancellation need an application workflow. See [HTTP Queries and Mutations](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).
