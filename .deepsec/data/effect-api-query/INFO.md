# effect-api-query

## Review scope

Review source and Git history. Support each finding or verdict with code references, relevant controls, and missing evidence. Describe impact and reachability at a high level. Keep the review read-only and omit exploit code, payloads, reproduction steps, and live requests.

## What this codebase does

`@ueberbrot/effect-api-query` is a TypeScript library that derives TanStack Query utility trees from Effect RPC and HttpApi contracts. The published entry points are the core library and an optional React subpath.

- `createRpcQueryUtils` and `createHttpApiQueryUtils` take ready clients and generate semantic keys, query and mutation options, direct calls, and supported stream views.
- `createHydrationRegistry` and `createQueryDescriptor` support transferring cache data and loader selections between runtimes. The host controls serialization, transport, and cache lifetime.
- The private examples share Effect handlers across a standalone Node server and a TanStack Start host. The Vite React example proxies API traffic to the standalone server in development and preview.
- The public Astro docs publish static package-version metadata. Local tooling and GitHub Actions handle checks, package releases, and docs deployment. The shipped agent skill is usage guidance.

## Auth shape

- The consuming application provides ready clients, credentials, server authorization, and cache identity. The utility factories and React providers have no session or role checks.
- `makeCallerVerifier` derives a `VerifiedCaller` from a configured bearer token or signed sessions. Write authority and operation ownership are distinct. `requireDemoWriter` protects user deletion and selected workflow writes through RPC or HTTP middleware.
- Command and diagnostic handlers use operation ownership checks in the handler layer. Inspect those checks alongside the contracts when reviewing access.
- `startRequestApplication` obtains a request-scoped caller through `makeExampleHost`. The decoded-message RPC client and SSR HTTP fetch use that same caller.
- `keyPrefix`, `acquireQueryOwner`, and request-local QueryClients separate cache state. Authorization decisions belong to the host and backend.

## Threat model

- **Example network requests.** Inbound requests cross Node or Start routing into a shared Web handler and the Effect codecs and middleware. The standalone listener defaults to loopback. Start example exposure depends on the hosting environment.
- **Host-wide example state.** HTTP and RPC share in-memory users and diagnostics. RPC commands use caller-supplied operation IDs for start, status, and cancellation. Review ownership where operations access shared state.
- **Resource lifetime.** The shared Web handler caps buffered request bodies at 1 MiB. Workflow uploads have additional multipart limits. Slow diagnostics, command fibers, and streaming responses have lifetimes beyond body parsing.
- **Cache and SSR data.** Request inputs become query keys, decoded results can cross into browser hydration, and the Vite example restores directory data from session storage. Review which identity and authority each cache, snapshot, and loader selection belongs to.
- **Release inputs.** GitHub events, manual docs version and ref selectors, npm metadata, and build artifacts cross into validation and deployment. Monthly CI is the scheduled job. The inspected code shows no application cron, broker-backed consumer, webhook receiver, or executable agent-tool endpoint.

## Project-specific patterns to flag

- **Cache identity drift.** Trace custom key encoders, optional `keyPrefix`, and `prepareInput`. Look for omitted response-affecting inputs, credentials in keys, mutations of retained inputs, and old work writing into a replacement cache.
- **Snapshot and descriptor trust.** Check `decodeQueries` and descriptor `bind` callers for trusted snapshot sources and intended operation and input selection. Hydration validates registered query data. Descriptor rebinding checks compatibility and canonical identity, which a caller can recompute.
- **Sensitive output retention.** The HTTP metadata view caches raw response headers. Contract-derived metadata hydration requires an explicit header allowlist or custom codec when enabled. Execution errors preserve the Effect `Cause`. Check which metadata and failures reach hydration, persistence, UI, or logs.
- **Example host assumptions.** Follow the verified caller through network requests, SSR, and handler middleware. Check that write authority and operation ownership survive that handoff.
- **Release provenance.** Follow `resolveDocumentationRevision`, `verifyDocumentationVersion`, and `version-packages.mts` across ref checks, the docs path allowlist, artifact handoff, and the jobs that receive npm or Pages write permissions.

## Known false-positives

- `queryOptions`, `mutationOptions`, `call`, and `effect` are client-side library entry points. Their names do not identify hosted endpoints.
- `runQueryEvents` and `consumeEvents` operate on caller-supplied Effect streams. Stream pacing, replay cursors, and local invalidation do not expose a webhook, broker queue, or application scheduler.
- Key canonicalization rejects `__proto__` and `constructor` properties, and utility path validation rejects reserved segments and collisions. Follow those guards before assigning risk to dynamic keys or projected tags.
- `If-Match` in the document example enforces revision concurrency. The health response and static package-version JSON intentionally provide public status or metadata.
- `skills/effect-api-query/SKILL.md` and the docs `llms.txt` integration publish guidance. They do not register executable agent tools.
