# Host Effect RPC inside TanStack Start

Status: Accepted. Supersedes part of ADR 0013.

Start hosts the standard Effect RPC HTTP protocol at its own exact `POST /rpc` route. This
demonstrates the full-stack integration. A host-neutral Web handler shares the implementation with
the standalone Node server, which continues to serve Vite React. The examples exercise separate
hosting adapters. ADR 0013's shared-host requirement no longer applies.
