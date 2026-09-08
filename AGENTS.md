## Agent skills

### Issue tracker

Before reading or updating GitHub issues, read [the issue tracker workflow](docs/agents/issue-tracker.md).

### Triage labels

When triaging issues, use [the five triage roles](docs/agents/triage-labels.md).

### Domain docs

Before exploring the codebase, read [the domain documentation guide](docs/agents/domain.md).

### Vite+

Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

### Testing

Use compile-time fixtures to verify the published type contract. Reserve runtime tests for behavior that can fail at runtime; avoid testing guarantees already enforced by the type system.

## Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely and follow its links when required.

If a particular Effect API or concept is not covered there, search the source in `node_modules/effect/src`.
