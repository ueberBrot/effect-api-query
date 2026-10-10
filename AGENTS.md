## Agent skills

### Shipped library skill

When changing public behavior, usage documentation, or shipped guidance, run
`vp exec intent meta generate-skill` and follow the installed maintenance procedure.
Read the shared [planning record](_artifacts/skill_spec.md); maintain its domain map
and skill tree alongside the affected guidance. Run `vp exec intent maintainer sync`,
review actual source changes with `vp exec intent maintainer review --json`, and
record justified outcomes for the owned skill, planning, and source items after
task checks. Leave unrelated skills unresolved. Finish with `vp run skills-check`.

### Issue tracker

Before reading or updating GitHub issues, read [the issue tracker workflow](docs/agents/issue-tracker.md).

### Triage labels

When triaging issues, use [the five triage roles](docs/agents/triage-labels.md).

### Domain docs

Before exploring the codebase, read [the domain documentation guide](docs/agents/domain.md) for `GLOSSARY.md` vocabulary and relevant ADRs.

### Vite+

Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

### Testing

Use compile-time fixtures to verify the published type contract. Reserve runtime tests for behavior that can fail at runtime; avoid testing guarantees already enforced by the type system.

## Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely and follow its links when required.

If a particular Effect API or concept is not covered there, search the source in `node_modules/effect/src`.
