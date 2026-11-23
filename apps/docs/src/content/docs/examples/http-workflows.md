---
title: HTTP Workflows
description: Try typed writes, streams, uploads, cache sharing, and event recovery.
---

Complete the [workspace setup](/effect-api-query/examples/#set-up-locally), then start the Vite app.

```sh
vp run vite-react-dev
```

Open `http://127.0.0.1:5173` and choose a screen from the navigation.

For Start, run `vp run tanstack-start-dev` and open `http://127.0.0.1:3000/workflows`. Both apps use the same workflow components. Start opens the workflow's resources in the browser, separately from server rendering. Leaving the route waits for local work before disposal.

| Screen | Try | Source |
| --- | --- | --- |
| First read and write | Write a title and seed the exact document query key. | [document.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/document.tsx) |
| HTTP metadata and ETags | Submit a title containing `blocked` for a typed error. Remember a revision, save a new title, then try the remembered revision for HTTP 412. | [document.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/document.tsx) |
| HTTP streaming | Switch between SSE and NDJSON. Compare bounded history with the 250 ms coalesced live view, then stop both queries. | [streams.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/streams.tsx) |
| Multipart upload | Submit a nonempty file up to 64 KiB. The client validates selections, and the server enforces HTTP 413 limits independently. | [upload.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/upload.tsx) |
| Decoded-value sharing | Refetch equal readings to see reference reuse. Change rooms to try prepared inputs and projected invalidation. | [readings.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/readings.tsx), [sharing.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/sharing.ts) |
| Event recovery | Resume after a disconnect, refresh after a sequence gap, or refresh expired replay. Notifications refresh the document query. Stop interrupts consumption and retry backoff. | [events.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/events.tsx), [recovery.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/recovery.ts) |

## Adapt an example

Start with the [contracts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/contracts/src/workflows.ts), [handlers](https://github.com/ueberBrot/effect-api-query/blob/main/examples/server/src/workflow-handlers.ts), and [client setup](https://github.com/ueberBrot/effect-api-query/blob/main/examples/shared/http-workflows/application.ts). The setup acquires a query owner and attaches typed policies and interceptors. Unmount consumers before disposal. Disposal cancels reads, stops event consumers, and drains accepted mutations before closing the runtime.

- Send ETags unchanged. Keep the server's atomic precondition check. See [HTTP metadata](/effect-api-query/guides/http-metadata/).
- Keep shared values, including dates, unchanged after caching. See [share decoded values](/effect-api-query/guides/share-decoded-values/).
- Map replay cursors to positions your server accepts. The demo uses decimal strings and a finite feed. `runQueryEvents` supplies the owner's cache. Notifications invalidate documents. Gaps and expired replay trigger a refresh. See [reconnect streams](/effect-api-query/guides/reconnect-streams/).
- Upload files through buffered mutations. For progress or server cancellation, design an app workflow. See [upload a file](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).
