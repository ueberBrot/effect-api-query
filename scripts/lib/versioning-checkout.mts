import { ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { pipeline } from "node:stream/promises";

import { capture, run } from "./exec.mts";

const diff = [
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--binary",
  "--no-color",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

const digestGeneratedPatch = async (
  base: string,
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => {
  const child = spawn(
    "git",
    [...diff, base, "--", ".", ":(exclude).intent/review-state.json"],
    { ...options, stdio: ["ignore", "pipe", "inherit"] }
  );
  const hash = createHash("sha256");
  await Promise.all([once(child, "close"), pipeline(child.stdout, hash)]);
  ok(
    child.exitCode === 0,
    `git diff failed (${child.signalCode ?? `exit ${child.exitCode}`}).`
  );
  return hash.digest("hex");
};

const linkNodeModules = (sourceDir: string, targetDir: string) => {
  mkdirSync(targetDir);
  for (const entry of readdirSync(sourceDir)) {
    const sourceEntry = nodePath.join(sourceDir, entry);
    const type =
      statSync(sourceEntry, { throwIfNoEntry: false })?.isDirectory() === true
        ? "junction"
        : "file";
    symlinkSync(sourceEntry, nodePath.join(targetDir, entry), type);
  }
};

export const withVersioningCheckout = async (
  generate: (checkout: {
    readonly base: string;
    readonly options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv };
    readonly source: string;
    readonly digestGeneratedPatch: () => Promise<string>;
  }) => Promise<void>
) => {
  const gitLocalVariables = new Set([
    ...capture("git", ["rev-parse", "--local-env-vars"]).trim().split("\n"),
    "GIT_LITERAL_PATHSPECS",
    "GIT_GLOB_PATHSPECS",
    "GIT_NOGLOB_PATHSPECS",
    "GIT_ICASE_PATHSPECS",
  ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !gitLocalVariables.has(name))
  );
  const cwd = capture("git", ["rev-parse", "--show-toplevel"], {
    env,
  }).replace(/\r?\n$/u, "");
  const git = (...args: string[]) => capture("git", args, { cwd, env });
  const assertClean = () => {
    ok(
      !git("status", "--porcelain", "--untracked-files=all").trim(),
      "Versioning requires a clean working tree."
    );
  };

  assertClean();
  const base = git("rev-parse", "HEAD").trim();
  const directory = mkdtempSync(
    nodePath.join(tmpdir(), "versioning-checkout-")
  );
  const worktree = nodePath.join(directory, "checkout");
  const patch = nodePath.join(directory, "release.patch");
  const paths = nodePath.join(directory, "release-paths");
  const options = { cwd: worktree, env };
  try {
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "worktree",
      "add",
      "--quiet",
      "--detach",
      worktree,
      base
    );
    const linkedNodeModules = nodePath.join(worktree, "node_modules");
    try {
      linkNodeModules(nodePath.join(cwd, "node_modules"), linkedNodeModules);
      await generate({
        base,
        options,
        source: cwd,
        digestGeneratedPatch: async () => digestGeneratedPatch(base, options),
      });
      capture("git", [...diff, `--output=${patch}`, base, "--", "."], options);
    } finally {
      rmSync(linkedNodeModules, { recursive: true, force: true });
      git("worktree", "remove", "--force", worktree);
    }

    ok(
      git("rev-parse", "HEAD").trim() === base,
      "The original checkout changed HEAD during versioning."
    );
    assertClean();
    if (statSync(patch).size > 0) {
      const apply = ["--whitespace=nowarn", patch];
      run("git", ["apply", "--check", ...apply], { cwd, env });
      const candidate = {
        cwd,
        env: {
          ...env,
          GIT_INDEX_FILE: nodePath.join(directory, "candidate-index"),
        },
      };
      run("git", ["read-tree", base], candidate);
      run("git", ["apply", "--cached", ...apply], candidate);
      try {
        run("git", ["apply", ...apply], { cwd, env });
      } catch (error) {
        try {
          ok(
            git("rev-parse", "HEAD").trim() === base,
            "The original checkout changed HEAD during patch application."
          );
          const list = ["diff", "--no-renames", "--name-only", "-z"];
          const differsFromCandidate = new Set(
            capture("git", list, candidate).split("\0")
          );
          const generatedPaths = capture(
            "git",
            [...list, "--cached", base],
            candidate
          )
            .split("\0")
            .filter(Boolean);
          const recreatedPaths = new Set(
            capture(
              "git",
              [...list, "--diff-filter=D", "--cached", base],
              candidate
            )
              .split("\0")
              .filter(
                (path) =>
                  path !== "" &&
                  lstatSync(nodePath.join(cwd, path), {
                    throwIfNoEntry: false,
                  }) !== undefined
              )
          );
          const appliedPaths = generatedPaths.filter(
            (path) =>
              !differsFromCandidate.has(path) && !recreatedPaths.has(path)
          );
          if (appliedPaths.length > 0) {
            writeFileSync(paths, `${appliedPaths.join("\0")}\0`);
            run(
              "git",
              [
                "--literal-pathspecs",
                "restore",
                "--worktree",
                `--source=${base}`,
                `--pathspec-from-file=${paths}`,
                "--pathspec-file-nul",
              ],
              { cwd, env }
            );
          }
          ok(
            !git(...list, base)
              .split("\0")
              .some((path) => generatedPaths.includes(path)),
            "Generated paths differ from both the starting checkout and the verified release."
          );
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            "Applying the generated release failed and Git could not restore the checkout.",
            { cause: restoreError }
          );
        }
        throw error;
      }
    }
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      console.warn("Versioning could not remove its temporary files.", error);
    }
  }
};
