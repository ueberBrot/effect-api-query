# Keep editor selection contributor-owned

Status: Accepted. Partially amends [ADR 0035](0035-use-effect-enhanced-tsrs-for-development.md); its command-line compiler selection remains accepted.

## Decision

Remove the repository-managed VS Code SDK launchers and forced TypeScript server settings at the maintainer's request. Contributors choose their editor extensions and language server. Optional upstream editor guidance does not configure the user's editor or claim graphical validation.

Keep the exact Effect-enhanced TSRS compiler for command-line checks, lint and declarations. Declaration generation resolves the installed platform binary directly; its identity must match the CLI. Builds do not depend on editor files.

## Consequences

No editor SDK or Windows command shim is checked in. Existing formatting settings remain. Consumer compiler support and Effect correctness checks are unchanged. Graphical editor and untested platform behavior remain explicit verification limits.
