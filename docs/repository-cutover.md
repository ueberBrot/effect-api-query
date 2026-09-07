# Repository cutover

The existing repository was renamed in place on 7 September 2026 for
[issue #72](https://github.com/ueberBrot/effect-api-query/issues/72). The package and documentation
preparation from #71 was already merged at `b23d7bf0a2f09c2a406f1f78fe5bd93093f118a6`.

## Canonical addresses

| Reference     | Address                                         |
| ------------- | ----------------------------------------------- |
| Repository    | https://github.com/ueberBrot/effect-api-query   |
| Documentation | https://ueberbrot.github.io/effect-api-query/   |
| SSH origin    | `git@github.com:ueberBrot/effect-api-query.git` |
| Package       | `effect-api-query`                              |

The root manifest and site configuration contain the current package metadata, documentation base,
and source/edit/social links. The repository description and homepage now match them.

## Preserved identity and settings

Before/after GitHub API snapshots confirmed the same repository database ID `1349852547`, node ID
`R_kgDOUHUdgw`, default branch `main`, and main commit. All 84 existing issue/PR records retained
their IDs, numbers, and states; all 34 native children of #1 survived. The recorded dependency
sets for #1, #19, #71, #72, and #73 were unchanged, including all 11 blockers of #19.
Issues #1 and #19 remain open; completed work remains closed.

There were no branch protections, rulesets, required checks, or repository webhooks to migrate.
Actions remained enabled with read-only default workflow permissions. Existing CI check names and
workflow IDs were preserved. The repository's installed-app page still lists its release bot
(installation `104164746`); no repository-side integration needed a slug change. Its account-level
configuration requires GitHub reauthentication and was not changed.

The existing `github-pages` environment retained its ID and `main` deployment policy. Pages still
uses workflow deployment, enforces HTTPS, and has no custom domain. The release workflow referred
to an absent `npm` environment; the cutover created it with a `main`-only deployment policy.
No credentials or npm account settings were added.

## Hosted verification

The [documentation deployment](https://github.com/ueberBrot/effect-api-query/actions/runs/34109083418)
succeeded for the prepared main commit above. The shared browser acceptance suite passed all 21
cases against the deployed site in Chromium, Firefox, and WebKit. It checks both quick starts,
sidebar navigation, real search results and assets, canonical source/edit/social links, branded SVG
icons, registry-version updates and fallback, generated text, and its internal documentation links.
Registry responses are controlled in the version cases; the other site responses come from Pages.

The [release dry run](https://github.com/ueberBrot/effect-api-query/actions/runs/34109094089)
passed artifact packing and isolated package verification from the same commit. Publication and
version-PR jobs were skipped: both require a `push` event, while this run used `workflow_dispatch`.
A fresh SSH clone from the canonical URL resolved the same commit and installed all six workspaces
with the frozen lockfile.

Direct unauthenticated requests observed these responses after deployment:

| Old address                                                         | Response                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `https://github.com/ueberBrot/effect-rpc-query`                     | 301 to the canonical repository                        |
| `https://github.com/ueberBrot/effect-rpc-query/pull/84`             | 301 to the same PR under the new name                  |
| `https://github.com/ueberBrot/effect-rpc-query/blob/main/README.md` | 301 to the same source path under the new name         |
| `https://github.com/ueberBrot/effect-rpc-query/issues/72`           | 404 for both GET and HEAD; use the canonical issue URL |
| `https://ueberbrot.github.io/effect-rpc-query/`                     | 404; no Pages redirect                                 |

The canonical Pages root returned 200. These are observed responses, not a promise that every old
URL redirects. Keep the old repository name vacant to preserve GitHub's available redirects.

## Repeat documentation acceptance

Run the configured documentation checks and browser suite against the local production preview.
To verify an existing deployment with the same suite:

```sh
DOCS_BASE_URL=https://ueberbrot.github.io vp run docs-e2e
```

The override supplies the origin; the suite retains the canonical project path and starts no local
preview server. Deployment remains available through the existing documentation workflow's manual
and reusable triggers, using the `github-pages` environment.

## Publication handoff

[Issue #19](https://github.com/ueberBrot/effect-api-query/issues/19) owns npm name control, trusted
publisher configuration, any first-publication bootstrap, final publication, and independent npm
verification. Its exact publisher identity is owner `ueberBrot`, repository `effect-api-query`,
workflow `release.yml` at `.github/workflows/release.yml`, and environment `npm`.
Issue #73 remains the final implementation gate before those operations.

## Existing checkouts

Update an existing SSH origin with:

```sh
git remote set-url origin git@github.com:ueberBrot/effect-api-query.git
```

The checkout directory is independent of package resolution. If you rename its folder, finish
active processes and reopen the editor at the new path. Existing caches and volumes remain usable.
