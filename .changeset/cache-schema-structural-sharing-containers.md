---
"@ueberbrot/effect-api-query": patch
---

Screen incoming values and cache plain array and object metadata once per pass in `schemaStructuralSharing`. Reusing container metadata across cycle detection, atom screening, and recursive sharing avoids repeated descriptor and own-key scans.
