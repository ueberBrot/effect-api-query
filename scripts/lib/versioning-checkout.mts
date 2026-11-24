import { ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
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

const digestPatch = async (
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

export const withVersioningCheckout = async (
  generate: (checkout: {
    readonly base: string;
    readonly options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv };
    readonly digest: () => Promise<string>;
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
    try {
      symlinkSync(
        nodePath.join(cwd, "node_modules"),
        nodePath.join(worktree, "node_modules"),
        "junction"
      );
      const envFile = nodePath.join(cwd, ".env");
      const versioningEnvFile = nodePath.join(worktree, ".env");
      if (
        !existsSync(versioningEnvFile) &&
        statSync(envFile, { throwIfNoEntry: false })?.isFile() === true
      ) {
        copyFileSync(envFile, versioningEnvFile);
      }
      await generate({
        base,
        options,
        digest: async () => digestPatch(base, options),
      });
      capture("git", [...diff, `--output=${patch}`, base, "--", "."], options);
      capture(
        "git",
        [
          "diff",
          "--no-renames",
          "--name-only",
          "-z",
          `--output=${paths}`,
          base,
          "--",
          ".",
        ],
        options
      );
    } finally {
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
      try {
        run("git", ["apply", ...apply], { cwd, env });
      } catch (error) {
        try {
          ok(
            git("rev-parse", "HEAD").trim() === base,
            "The original checkout changed HEAD during patch application."
          );
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
    rmSync(directory, { recursive: true, force: true });
  }
};
