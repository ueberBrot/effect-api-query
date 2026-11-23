---
name: delete-comment
description: Audit code comments, act on each category, and tighten the repo/no-comments ratchet.
disable-model-invocation: true
---

# Delete Comment

Audit code comments in the target scope (the whole repository by default, or the files the user names), resolve every disallowed comment, and tighten the `repo/no-comments` ratchet in `vite.config.ts`.

## Context pointers

- Read [`scripts/oxlint-no-comments.mts`](../../../scripts/oxlint-no-comments.mts) for the authoritative list of allowed directives and public API JSDoc prefixes.
- Read [`docs/agents/domain.md`](../../../docs/agents/domain.md) before creating an ADR.
- Read [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) before filing GitHub issues.

## Steps

1. **Inventory.** Parse every source file in scope with the TypeScript AST (`ts.getLeadingCommentRanges` and `ts.getTrailingCommentRanges`) so string and regex literals are skipped. Separate public API JSDoc/TSDoc in `src/` and machine directives (kept) from all other comments, including files currently ratcheted in `vite.config.ts`. Completion: every file in scope is scanned and every candidate comment is listed with file, line, and line count.
2. **Classify and act.** Assign each candidate comment to one category and execute its action:
   - **Tautology** (repeats what the code, types, assertion message, or an existing ADR already states): delete it.
   - **Stale** (references code or constraints that no longer hold): delete it.
   - **Excuse** (justifies a workaround, hack, or unsafe type assertion): file a GitHub issue describing the underlying hack and proposed fix; delete the comment when other lint rules permit, or keep it in the ratchet when a stricter lint rule requires it until the hack is fixed.
   - **Decision Record** (documents a non-obvious, hard-to-reverse trade-off absent from `docs/adr/`): record it in the next numbered ADR under `docs/adr/`, then delete the comment.
   Completion: every candidate comment has a recorded category and completed action.
3. **Tighten the ratchet.** Update `repo/no-comments` in `vite.config.ts` so every ratcheted file matches its new lower comment count, removing entries that reach `0`. Only lower existing limits or remove entries. Completion: `vite.config.ts` matches the exact remaining count per ratcheted file.
4. **Verify and report.** Run `vp fmt && vp run check && vp exec intent maintainer check` (recording Intent review outcomes if tracked files changed). Completion: all checks exit `0`. Report:
   - The table of classified comments and actions taken (with ADR and issue links).
   - Remaining ratcheted files and counts.
   - Exact lines shed in this pass and remaining lines to shed when the ratchet reaches zero.
