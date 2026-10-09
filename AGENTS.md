## Agent skills

### Issue tracker

Before reading or updating GitHub issues, read [the issue tracker workflow](docs/agents/issue-tracker.md).

### Triage labels

When triaging issues, use [the five triage roles](docs/agents/triage-labels.md).

### Domain docs

Before exploring the codebase, read [the domain documentation guide](docs/agents/domain.md) for `GLOSSARY.md` vocabulary and relevant ADRs.

### Vite+

Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

### Dependency installs

Before installing or changing dependencies, read [the install policy](docs/agents/install-policy.md). Every registry dependency must satisfy pnpm's strict seven-day quarantine, including isolated consumers and frozen or cached installs. No exceptions or bypasses.

### Testing

Use compile-time fixtures to verify the published type contract. Reserve runtime tests for behavior that can fail at runtime; avoid testing guarantees already enforced by the type system.

## Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely and follow its links when required.

If a particular Effect API or concept is not covered there, search the source in `node_modules/effect/src`.
