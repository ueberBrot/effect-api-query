---
title: RPC Utility Tree
description: Understand how RPC tags become nested query utilities.
---

`createRpcQueryUtils` builds and freezes an RPC utility tree when you call it. It splits dotted
unary and streaming RPC tags into nested paths:

| RPC tag                    | Generated path                            |
| -------------------------- | ----------------------------------------- |
| `users.get`                | `rpcQuery.users.get`                      |
| `projects.by-id.find`      | `rpcQuery.projects['by-id'].find`         |
| `billing-history.list all` | `rpcQuery['billing-history']['list all']` |

Each branch has `key()`. Unary leaves add ordinary query, infinite-query, and mutation builders.
Streaming leaves add accumulated-stream and live-query builders. The factory builds the tree once,
rejecting invalid tags, collisions, and invalid encoder configuration during construction.

Reserved builder names cannot appear where they would collide with generated members. See
[Generated Builders](/effect-api-query/reference/generated-builders/) for the leaf interface.
