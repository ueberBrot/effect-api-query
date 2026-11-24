import { ok } from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { capture, git, run } from "./lib/exec.mts";

const splitPaths = (output: string) => output.split("\0").filter(Boolean);
const planning = new Set([
  "_artifacts/domain_map.yaml",
  "_artifacts/skill_spec.md",
  "_artifacts/skill_tree.yaml",
]);
const rootMarkdown = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "CHANGELOG.md",
  "GLOSSARY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
]);
const checkFiles = (files: string[]) => {
  const rejected = files.filter(
    (file) =>
      (file.startsWith("_artifacts/") && !planning.has(file)) ||
      /^(?:\.artifacts|\.scratch|scratch|reports|audits)\//u.test(file) ||
      (!file.includes("/") && /\.mdx?$/iu.test(file) && !rootMarkdown.has(file))
  );
  ok(
    rejected.length === 0,
    `Unexpected repository files:\n${rejected.join("\n")}\nKeep session output in the OS temporary directory or ignored .artifacts/. See docs/agents/domain.md.`
  );
};
const pullRequestsQuery = `
  query($owner: String!, $repo: String!, $branch: String!, $endCursor: String) {
    repository(owner: $owner, name: $repo) {
      nameWithOwner
      pullRequests(headRefName: $branch, states: [OPEN, CLOSED, MERGED], first: 100, after: $endCursor) {
        nodes { headRefName headRepository { nameWithOwner } state }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;
const unknownPrState =
  "Could not determine PR state; check gh authentication and retry.";

const repositoryName = Schema.Struct({ nameWithOwner: Schema.NonEmptyString });
const decodePullRequestPages = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.NonEmptyArray(
      Schema.Struct({
        data: Schema.Struct({
          repository: Schema.Struct({
            ...repositoryName.fields,
            pullRequests: Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({
                  headRefName: Schema.NonEmptyString,
                  headRepository: Schema.NullOr(repositoryName),
                  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
                })
              ),
              pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
            }),
          }),
        }),
      })
    )
  )
);
const queryPullRequestPages = (remote: string, branch: string) => {
  const url = new URL(
    remote.replace(/^git@(?<host>[^:]+):/u, "ssh://git@$<host>/")
  );
  const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
  const identity = /^\/(?<owner>[\w-]+)\/(?<repo>[\w.-]+?)\/?$/u.exec(
    decodeURIComponent(url.pathname)
  )?.groups;
  const owner = identity?.["owner"];
  const repo = identity?.["repo"]?.replace(/\.git$/u, "");
  ok(
    owner !== undefined && repo !== undefined && repo !== "" && hostname !== "",
    "Could not identify the GitHub push repository."
  );
  const pages = decodePullRequestPages(
    capture("gh", [
      "api",
      "graphql",
      "--hostname",
      hostname,
      "--paginate",
      "--slurp",
      "-f",
      `query=${pullRequestsQuery}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-f",
      `branch=${branch}`,
    ])
  );
  ok(Option.isSome(pages), unknownPrState);
  return pages.value;
};

const pullRequestState = (remote: string, branch: string) => {
  const pages = queryPullRequestPages(remote, branch);
  let open = false;
  let merged = false;
  for (const [index, { data }] of pages.entries()) {
    const { nameWithOwner, pullRequests } = data.repository;
    ok(
      pullRequests.pageInfo.hasNextPage === index < pages.length - 1,
      unknownPrState
    );
    const destination = nameWithOwner.toLowerCase();
    for (const { headRefName, headRepository, state } of pullRequests.nodes) {
      if (
        headRefName !== branch ||
        headRepository?.nameWithOwner.toLowerCase() !== destination
      ) {
        continue;
      }
      open ||= state === "OPEN";
      merged ||= state === "MERGED";
    }
  }
  return { open, merged };
};

const zero = /^0+$/u;
const [mode, , remote] = process.argv.slice(2);
if (mode === "--push") {
  if (remote !== undefined) {
    const changed = new Set<string>();
    for (const line of readFileSync(0, "utf-8").trim().split("\n")) {
      if (!line) {
        continue;
      }
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/u);
      ok(
        localRef !== undefined &&
          localSha !== undefined &&
          remoteRef !== undefined &&
          remoteSha !== undefined,
        "Invalid Git pre-push input."
      );
      if (zero.test(localSha) || !remoteRef.startsWith("refs/heads/")) {
        continue;
      }
      ok(
        localSha === git("rev-parse", "HEAD").trim(),
        "Check out the branch being pushed so its targeted checks run against the pushed code."
      );
      ok(
        git("status", "--porcelain", "--untracked-files=all").trim() === "",
        "Commit or stash working changes before pushing so checks cover the pushed commit."
      );
      const branch = remoteRef.slice("refs/heads/".length);
      const { open, merged } = pullRequestState(remote, branch);
      ok(
        open || !merged,
        `PR branch ${branch} is already merged. Start follow-up work from current main on a new branch.`
      );
      checkFiles(
        splitPaths(git("ls-tree", "-r", "--name-only", "-z", localSha))
      );
      const base = zero.test(remoteSha)
        ? git("merge-base", localSha, "refs/remotes/origin/main").trim()
        : remoteSha;
      for (const file of splitPaths(
        git("diff", "--name-only", "-z", base, localSha)
      )) {
        changed.add(file);
      }
    }
    if (
      [...changed].some((file) =>
        /^(?:vite\.config\.ts|scripts\/(?:compiler|check-workflow|lib\/exec)\.mts|scripts\/check-skills\.sh|\.vite-hooks\/|tests\/(?:skills-maintenance|workflow-guards)\.test\.ts)/u.test(
          file
        )
      )
    ) {
      run("vp", [
        "test",
        "--",
        "tests/skills-maintenance.test.ts",
        "tests/workflow-guards.test.ts",
      ]);
    }
    if (
      [...changed].some((file) =>
        /^(?:pnpm-(?:workspace|lock)\.yaml|package\.json|examples\/[^/]+\/package\.json|scripts\/check-effect-compatibility\.mts)$/u.test(
          file
        )
      )
    ) {
      run("vp", ["run", "effect-compatibility"]);
    }
  }
} else {
  ok(
    mode === undefined || mode === "--staged",
    "Use --staged or --push <remote> <url>."
  );
  checkFiles(
    splitPaths(
      mode === "--staged"
        ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
        : git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
    )
  );
}
