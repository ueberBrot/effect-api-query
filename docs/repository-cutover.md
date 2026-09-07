# Hosted documentation cutover

Issue #70 prepares the documentation for the rename. The new addresses below are cutover targets,
not evidence of a deployed site. Execute this checklist in #72 after #71 certifies the package.

| Reference      | Before cutover                                  | Target                                          |
| -------------- | ----------------------------------------------- | ----------------------------------------------- |
| Repository     | `ueberBrot/effect-rpc-query`                    | `ueberBrot/effect-api-query`                    |
| Pages root     | `https://ueberbrot.github.io/effect-rpc-query/` | `https://ueberbrot.github.io/effect-api-query/` |
| npm package    | `effect-api-query`                              | `effect-api-query`                              |
| Docs workspace | `@effect-api-query/docs`                        | `@effect-api-query/docs`                        |

The package repository URL is `git+https://github.com/ueberBrot/effect-api-query.git`, its homepage
is `https://github.com/ueberBrot/effect-api-query#readme`, and its issue URL is
`https://github.com/ueberBrot/effect-api-query/issues`. The changelog repository slug is
`ueberBrot/effect-api-query`. These local inputs are prepared; #72 verifies the hosted targets.
After the rename, set an SSH origin with
`git remote set-url origin git@github.com:ueberBrot/effect-api-query.git`.

The repository database ID is `1349852547` (node ID `R_kgDOUHUdgw`), with default branch `main`.
Confirm these identities before and after cutover; renaming must preserve the existing repository.

1. Record the repository database identity, default branch, current commit, settings, native
   sub-issues, and dependency edges. Verify that the target repository name is usable and that
   #71's metadata preparation has merged. Rename the existing repository in place.
2. Update local remotes and the repository homepage to the target addresses. Inspect protections,
   environments, required checks, and installed integrations for references to the old slug.
   Confirm that the repository identity, history, issues, PRs, and dependency edges survived.
3. Run the configured docs checks, build, and browser acceptance against the selected commit.
   Inspect source/edit/social links, the npm version link and fallback, SVG metadata, and generated
   `llms.txt`, `llms-full.txt`, and linked Markdown under the target Pages root.
4. Dispatch `.github/workflows/deploy-docs.yml` from the reviewed commit through its existing
   `workflow_dispatch` trigger. Preserve its reusable `workflow_call` trigger and `github-pages`
   environment. Record the successful workflow and deployment URL.
5. Open the deployed target URL directly. Follow both quick starts, sidebar links, search results,
   and source/edit links. Check script, stylesheet, icon, and search asset responses. Repeat the
   generated-text URL checks against the hosted files. Preview results alone do not verify Pages.
6. Request both old repository and old Pages URLs and record their actual status and redirect
   targets separately. Repository redirects do not establish Pages behavior. Keep the old
   repository name vacant so its redirects remain available.
7. Clone the new repository URL into a fresh disposable directory, install the declared workspace,
   and verify source links and workflow access. Link the evidence in #72 and pass the canonical
   repository identity, `.github/workflows/release.yml`, and `npm` publication environment to #19.
   Account configuration and publication remain in that human issue.

The site configuration, workspace manifest, and root task graph are authoritative for executable
paths and commands. The rename does not require moving an existing checkout. To change its folder
name, close the editor, move the checkout yourself, and reopen it; keep existing caches and volumes.
