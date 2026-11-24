---
"@ueberbrot/effect-api-query": patch
---

Clear seeded RPC and HTTP accumulated stream data when a reset refetch starts. The query enters pending without cached data, and a failure before the first emission leaves the data cleared.
