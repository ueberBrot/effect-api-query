# Domain documentation

Read the glossary and relevant decisions before exploring the codebase.

## Read before exploring

- Read [`CONTEXT.md`](../../CONTEXT.md) for the project's domain vocabulary.
- Read decisions in [`docs/adr/`](../adr/) that affect the area you are working on.

If a file is missing, proceed without mentioning its absence or proposing a replacement. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates these files when terms or decisions are resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If a concept is missing from the glossary, check whether an existing term covers it. If none does, note the gap for `/domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, link to that decision and explain why it should be revisited. Preserve the decision until a replacement is agreed.
