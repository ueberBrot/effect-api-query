## Agent skills

### Shipped library skill

When changing public behavior, usage documentation, or shipped guidance, run `vp exec intent meta generate-skill` and follow the installed maintenance procedure. Read the shared [planning record](_artifacts/skill_spec.md); maintain its domain map and skill tree alongside the affected guidance. Run `vp exec intent maintainer sync`, review actual source changes with `vp exec intent maintainer review --json`, and record justified outcomes for the owned skill, planning, and source items after task checks. Leave unrelated skills unresolved. Run `vp exec intent maintainer check`, report pending work, and finish with `vp run skills-check`.

### Issue tracker

Before reading or updating GitHub issues, read [the issue tracker workflow](docs/agents/issue-tracker.md).

### Triage labels

When triaging issues, use [the five triage roles](docs/agents/triage-labels.md).

### Repository files

Before creating tracked documentation or reports, follow [file placement](docs/agents/domain.md#file-placement).

### Domain docs

Before exploring the codebase, read [the domain documentation guide](docs/agents/domain.md) for `GLOSSARY.md` vocabulary and relevant ADRs.

### Vite+

Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

### Contributor compiler

Use the pinned Node and pnpm versions and install with `pnpm install --frozen-lockfile`. For compiler changes, run `vp run toolchain-check`, `vp run typecheck`, `vp run effect-check`, and `vp run pack`. Check public types with `vp run api-types`. The pinned Effect-enhanced TSRS handles development and declaration output. TypeScript 5.9 remains the consumer minimum. See [ADR 0035](docs/adr/0035-use-effect-enhanced-tsrs-for-development.md) for the compiler decision.

Leave editor and language-server selection to contributors. Effect diagnostics require an Effect-enhanced server. See [ADR 0043](docs/adr/0043-keep-editor-selection-contributor-owned.md) for editor ownership.

### Testing

Use compile-time fixtures to verify the published type contract. Reserve runtime tests for behavior that can fail at runtime; avoid testing guarantees already enforced by the type system.

## Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely and follow its links when required.

If a particular Effect API or concept is not covered there, search the source in `node_modules/effect/src`.
