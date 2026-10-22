---
"@ueberbrot/effect-api-query": minor
---

Add `findDeclaredError` to return an Effect `Option` narrowed to one tagged failure. Defects, interruptions, composite Causes, and non-wrapper errors do not match; the original error and complete Cause remain available.
