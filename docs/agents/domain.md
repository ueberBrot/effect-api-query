# Domain documentation

Read the glossary and relevant decisions before exploring the codebase.

## Read before exploring

- Read [`GLOSSARY.md`](../../GLOSSARY.md) for the project's domain vocabulary.
- Read decisions in [`docs/adr/`](../adr/) that affect the area you are working on.

If a file is missing, proceed without mentioning its absence or proposing a replacement. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates these files when terms or decisions are resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If a concept is missing from the glossary, check whether an existing term covers it. If none does, note the gap for `/domain-modeling`.

## Maintain ADR history

If a proposal contradicts an existing ADR, link to that decision and explain why it should be revisited. Preserve the decision until a replacement is agreed.

Preserve an accepted ADR's recorded context, decision, and consequences. Record a replacement decision in the next numbered ADR, with reciprocal supersession links. For a partial amendment, identify the changed constraint and link both records; retain accepted status for the decision that still applies.

Update statuses, links, and editorial wording when the recorded meaning is preserved.

## File placement

Put session plans, review reports, handoffs and measurement output in the OS temporary directory or ignored `.artifacts/`. Commit maintained user guidance in the existing documentation sections and executable tooling in `scripts/` with its checks in `tests/`.

`_artifacts/` contains only Intent's domain map, skill specification and skill tree. The repository check enforces those paths, rejects tracked scratch/report directories, and limits root Markdown to project entry documents. Change the allowlist deliberately when a new maintained entry document is needed; do not rename temporary output to bypass it.

Before adding documentation, identify its recurring reader or the tool that consumes it. Prefer an existing section. Preserve externally supplied skills; put repository-specific additions in owned documentation or checks.
