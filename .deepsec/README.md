# DeepSec

This workspace reviews the parent repository. It keeps its dependency lockfile, configuration, and project context under `.deepsec/`.

## Setup

Install the pinned dependency from the repository root.

```sh
pnpm --dir .deepsec install --frozen-lockfile
```

AI review uses a local Codex login and the model in [deepsec.config.ts](deepsec.config.ts). The pattern scan works without model authentication.

## Run a review

Run these tasks from the repository root.

| Command | What it does |
| --- | --- |
| `vp run deepsec:scan` | Scan with built-in and project matchers, then review the candidates with Codex. |
| `vp run deepsec:status` | Show local scan and review status. |
| `vp run deepsec:revalidate` | Review existing findings against the current source and Git history. |
| `vp run deepsec:export` | Export findings to `data/effect-api-query/reports/findings/`. |
| `vp run deepsec:export-confirmed` | Export confirmed findings to `data/effect-api-query/reports/confirmed-findings/`. |

For a pattern scan by itself, run `pnpm --dir .deepsec exec deepsec scan`. Report paths are relative to `.deepsec/`. Run state, reports, and credentials are gitignored.

[Project context](data/effect-api-query/INFO.md) guides AI review. [Setup instructions](data/effect-api-query/SETUP.md) cover maintaining the context and matchers. The installed documentation lives in `node_modules/deepsec/dist/docs/`. [DeepSec documentation](https://github.com/vercel-labs/deepsec/tree/main/docs)
