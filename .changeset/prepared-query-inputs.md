---
"@ueberbrot/effect-api-query": minor
---

Add `prepareInput` to reuse construction, encoding, and canonicalization across repeated keys and query options on the same leaf. Retained execution inputs must remain unchanged. Handles cannot cross utility owners or replace mutation variables or infinite page mapper results.

Breaking changes: none.
