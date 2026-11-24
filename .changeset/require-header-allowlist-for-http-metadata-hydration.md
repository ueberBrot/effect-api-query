---
"@ueberbrot/effect-api-query": minor
---

`createContractHydrationRegistry` omits HTTP `metadata` codecs by default so unfiltered server-only response headers do not enter browser snapshots. Opt into derived metadata hydration with an explicit allowlist (`views: { metadata: { headers: [...] } }` or `paths[path].metadata: { headers: [...] }`) or supply a custom metadata codec.
