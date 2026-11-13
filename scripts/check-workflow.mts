import { ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const capture = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: "utf-8" });
const git = (...args: string[]) => capture("git", args);
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
const zero = /^0+$/u;
const [mode, , remote] = process.argv.slice(2);
if (mode === "--push") {
  if (remote !== undefined) {
    const repo = remote
      .replace(/^git@(?<host>[^:]+):/u, "https://$<host>/")
      .replace(/\.git$/u, "");
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
      const state = capture("gh", [
        "pr",
        "list",
        "--repo",
        repo,
        "--head",
        branch,
        "--state",
        "all",
        "--json",
        "state,mergedAt",
        "--jq",
        '[any(.[]; .state == "OPEN"), any(.[]; .mergedAt != null)] | @tsv',
      ]).trim();
      ok(
        state === "true\tfalse" ||
          state === "true\ttrue" ||
          state === "false\tfalse" ||
          state === "false\ttrue",
        "Could not determine PR state; check gh authentication and retry."
      );
      ok(
        state !== "false\ttrue",
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
        /^(?:vite\.config\.ts|scripts\/(?:compiler|check-workflow)\.mts|scripts\/check-skills\.sh|\.vite-hooks\/|tests\/(?:skills-maintenance|workflow-guards)\.test\.ts)/u.test(
          file
        )
      )
    ) {
      execFileSync(
        "vp",
        [
          "test",
          "--",
          "tests/skills-maintenance.test.ts",
          "tests/workflow-guards.test.ts",
        ],
        {
          stdio: "inherit",
        }
      );
    }
    if (
      [...changed].some((file) =>
        /^(?:pnpm-(?:workspace|lock)\.yaml|package\.json|examples\/[^/]+\/package\.json|scripts\/check-effect-compatibility\.mts)$/u.test(
          file
        )
      )
    ) {
      execFileSync("vp", ["run", "effect-compatibility"], { stdio: "inherit" });
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
