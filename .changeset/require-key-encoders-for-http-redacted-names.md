---
"@ueberbrot/effect-api-query": minor
---

HTTP utility construction requires a custom key encoder when declared headers, query parameters, or URL-encoded non-body payloads match `HttpApi.RedactedNames` at the API, group, or endpoint level. Supply a safe `keyEncoders` entry or move credentials to transport middleware so annotated secrets do not enter canonical keys or dehydrated snapshots.
