---
title: RPC Utility Tree
description: Understand how RPC tags become nested query utilities.
---

`createRpcQueryUtils` builds a frozen object with methods for each RPC. Dots in tags become nested properties.

| RPC tag                    | Generated path                            |
| -------------------------- | ----------------------------------------- |
| `users.get`                | `rpcQuery.users.get`                      |
| `projects.by-id.find`      | `rpcQuery.projects['by-id'].find`         |
| `billing-history.list all` | `rpcQuery['billing-history']['list all']` |

Each branch has `key()`. Unary RPCs add query, infinite query, and mutation builders. Streaming RPCs add accumulated and live query builders. The factory rejects invalid tags, collisions, and invalid key encoders.

Choose tags that leave room for method names such as `key` and `queryOptions`. See [RPC builders](/effect-api-query/reference/generated-builders/) for the full list.
