---
title: RPC Utility Tree
description: Understand how RPC tags become nested query utilities.
---

`createRpcQueryUtils` builds and freezes the complete RPC utility tree when called. Dots in unary
and streaming RPC tags define nested paths:

| RPC tag                    | Generated path                            |
| -------------------------- | ----------------------------------------- |
| `users.get`                | `rpcQuery.users.get`                      |
| `projects.by-id.find`      | `rpcQuery.projects['by-id'].find`         |
| `billing-history.list all` | `rpcQuery['billing-history']['list all']` |

Each branch has `key()`. Unary leaves add ordinary query, infinite-query, and mutation builders.
Streaming leaves add builders for accumulated streamed queries and live queries. The factory builds
the tree once. It rejects invalid tags, collisions, and invalid encoder configuration during construction.

Reserved builder names cannot occupy paths that collide with generated members.
[Generated Builders](/effect-api-query/reference/generated-builders/) describes the leaf interface.
