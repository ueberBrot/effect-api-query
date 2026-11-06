---
title: HTTP Workflows
description: Run focused examples of typed writes, HTTP streams, uploads, cache sharing, and event recovery.
---

Run `vp run vite-react-dev` from the repository root, then open `http://127.0.0.1:5173`. The example navigation links to six focused screens. They share the [workflow contract](https://github.com/ueberBrot/effect-api-query/blob/main/examples/contracts/src/workflows.ts) and [server handlers](https://github.com/ueberBrot/effect-api-query/blob/main/examples/server/src/workflow-handlers.ts).

## First read and write

Open **First read and write**. The application acquires a ready HTTP client and creates its QueryClient and configured utilities once. Native Query hooks consume the generated options. Choose **Write and seed the cache** to send a typed mutation, seed the ordinary document query's exact key, and refresh its metadata view.

Copy [application.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/application.ts) and [document.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/document.tsx). The application uses execution interceptors to track complete attempts. On disposal it stops event consumers, cancels queries, drains accepted work, clears the cache, and disposes its runtime. Unmount components before calling disposal, as the example entry point does. Accepted mutations finish rather than receiving a query cancellation signal.

## HTTP metadata and ETags

Open **HTTP metadata and ETags**. The screen displays decoded data, the status, and the quoted response ETag from `metadataOptions`.

- Enter a title containing `blocked` and choose **Save title** to see the declared validation message.
- Choose **Remember this revision**, save a valid title, then choose **Try remembered revision**. The server rejects the stale ETag with HTTP 412.
- Choose **Refresh metadata views** to invalidate the document branch's metadata view with `createBranchQueryFilter`.

The example uses `findDeclaredError` for `TitleRejected` and `RevisionConflict`. Other failures retain the execution-error fallback. Copy the server's atomic precondition check together with the client workflow. An ETag is opaque: send the response header unchanged. See [HTTP Metadata](/effect-api-query/guides/http-metadata/).

## HTTP streaming

Open **HTTP streaming**, select **SSE** or **NDJSON**, and choose **Start streams**. Both formats deliver eight updates through the ready client. Accumulated history retains four values. Its first event publishes immediately; subsequent publications flush at three events or 180 milliseconds. The live view publishes each latest value.

Choose **Stop streams** during delivery to cancel the two exact query keys. These are ordinary Query hooks so native cancellation can close their iterators. Shared `configureUtils` policies supply retention and publication controls to the key and options builders.

Copy [streams.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/streams.tsx). Effect owns framing and decoding; publication batching changes cache updates, not network request aggregation.

## Multipart upload

Open **Multipart upload**, choose a nonempty file up to 64 KiB, and submit it. The pending state ends with the received filename and byte count. An oversized selection shows a local validation error. The server independently enforces its multipart limits and returns HTTP 413 for an oversized file.

Copy [upload.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/upload.tsx). The mutation receives explicit FormData. The raw server handler applies the same declared limits, validates the persisted payload, and converts multipart failures to their HTTP responses. Request-scoped cleanup removes temporary files. The host provides a real Node filesystem for persistence.

This buffered mutation does not report byte-level progress or promise mutation cancellation. Use an application command if the upload starts cancellable work. See [HTTP Queries and Mutations](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).

## Decoded-value sharing

Open **Decoded-value sharing**. Each response decodes fresh Schema class instances containing dates. With sharing enabled, choose **Refetch equal readings**: equivalent cards keep their references and committed-render counts. **Change first reading** replaces that card while preserving its neighbor. Disable sharing and refetch to compare reference changes.

Choose another room to create a distinct cache entry. A `prepareInput` handle reuses preparation while the selected room is unchanged. **Refresh this room** uses an explicit `createQueryFilter` projection and leaves other room keys unmatched.

Copy [readings.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/readings.tsx) and [sharing.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/sharing.ts). Keep cached readings and their dates immutable. The counter illustrates committed renders in this example; it is not a performance benchmark. See [Share Decoded Values](/effect-api-query/guides/share-decoded-values/).

## Event recovery

Open **Event recovery** and choose a delivery scenario:

| Scenario | Observable behavior |
| --- | --- |
| Disconnect and resume | Accept 1–3, reconnect after cursor 3, then accept 4–8. |
| Refresh after a gap | Refresh the authoritative document before accepting sequence 5 after sequence 3. |
| Refresh expired replay | Read snapshot cursor 5, refresh the authoritative document, and reconnect for 6–8. |

The screen displays the connection state, accepted sequences, and refresh count. **Stop event consumer** interrupts consumption or retry backoff. Leaving the screen stops its consumer before owner disposal.

Copy [recovery.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/recovery.ts) and [events.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/workflows/events.tsx). `consumeEvents` keeps notification history out of the Query cache. `recoverStream` owns one consumption's accepted cursor; the server's deterministic scenarios demonstrate a replay protocol, not a durable event store. The UI holds only the finite demonstration sequence. Real applications define their retention, replay, and gap policy. See [Reconnect Streams](/effect-api-query/guides/reconnect-streams/).
