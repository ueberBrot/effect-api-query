import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { buffer } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";

import { fixtureGitEnvironment } from "./fixtures/git-environment";

const repository = nodePath.resolve(import.meta.dirname, "..");
const fixture = mkdtempSync(nodePath.join(tmpdir(), "version-packages-"));
const fixtureEnv = fixtureGitEnvironment();
const run = (cwd: string, command: string, args: string[]) =>
  execFileSync(command, args, {
    cwd,
    env: fixtureEnv,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const git = (cwd: string, ...args: string[]) => run(cwd, "git", args);
const intent = (cwd: string, ...args: string[]) =>
  run(cwd, "vp", ["exec", "intent", "maintainer", ...args]);
const commit = (cwd: string) => {
  git(cwd, "add", ".");
  git(cwd, "-c", "core.hooksPath=/dev/null", "commit", "-m", "Fixture");
};
const write = (cwd: string, file: string, content: string) => {
  writeFileSync(nodePath.join(cwd, file), content);
};
const read = (cwd: string, file: string) =>
  readFileSync(nodePath.join(cwd, file), "utf-8");

const version = (cwd: string, env?: NodeJS.ProcessEnv) =>
  env
    ? spawnSync("node", ["scripts/version-packages.mts"], {
        cwd,
        env,
        encoding: "utf-8",
      })
    : spawnSync("vp", ["run", "version-packages"], {
        cwd,
        env: fixtureEnv,
        encoding: "utf-8",
      });

const withCommand = (cwd: string, command: "git" | "vp", script: string) => {
  const bin = nodePath.join(cwd, ".git", "test-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(nodePath.join(bin, command), `#!/bin/sh\n${script}\n`, {
    mode: 0o755,
  });
  return {
    ...fixtureEnv,
    PATH: `${bin}${nodePath.delimiter}${fixtureEnv["PATH"] ?? ""}`,
    FIXTURE_COMMAND: run(cwd, "sh", [
      "-c",
      'command -v "$1"',
      "sh",
      command,
    ]).trim(),
  };
};

const withCheckout = <Result>(test: (cwd: string) => Result): Result => {
  const cwd = mkdtempSync(nodePath.join(tmpdir(), "version-packages-case-"));
  onTestFinished(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
  git(cwd, "clone", "--shared", fixture, ".");
  git(cwd, "config", "user.name", "Release test");
  git(cwd, "config", "user.email", "release-test@example.invalid");
  symlinkSync(
    nodePath.join(repository, "node_modules"),
    nodePath.join(cwd, "node_modules")
  );
  return test(cwd);
};

describe("Changesets Intent review integration", () => {
  beforeAll(() => {
    git(fixture, "init", "--initial-branch=main");
    git(fixture, "config", "user.name", "Release test");
    git(fixture, "config", "user.email", "release-test@example.invalid");
    symlinkSync(
      nodePath.join(repository, "node_modules"),
      nodePath.join(fixture, "node_modules")
    );
    write(fixture, ".gitignore", "node_modules\n.vite\n");
    const script = /"version-packages":\s*"(?<script>[^"]+)"/u.exec(
      read(repository, "package.json")
    )?.groups?.["script"];
    write(
      fixture,
      "package.json",
      JSON.stringify({
        name: "release-fixture",
        version: "0.1.0",
        type: "module",
        files: ["src", "skills"],
        packageManager: "pnpm@12.13.0",
        scripts: { "version-packages": script },
      })
    );
    mkdirSync(nodePath.join(fixture, ".changeset"));
    write(
      fixture,
      ".changeset/config.json",
      JSON.stringify({
        baseBranch: "main",
        changelog: ["@changesets/cli/changelog", {}],
      })
    );
    mkdirSync(nodePath.join(fixture, "scripts/lib"), { recursive: true });
    cpSync(
      nodePath.join(repository, "scripts/version-packages.mts"),
      nodePath.join(fixture, "scripts/version-packages.mts")
    );
    cpSync(
      nodePath.join(repository, "scripts/check-changesets.mts"),
      nodePath.join(fixture, "scripts/check-changesets.mts")
    );
    cpSync(
      nodePath.join(repository, "scripts/lib/exec.mts"),
      nodePath.join(fixture, "scripts/lib/exec.mts")
    );
    cpSync(
      nodePath.join(repository, "scripts/lib/versioning-checkout.mts"),
      nodePath.join(fixture, "scripts/lib/versioning-checkout.mts")
    );
    run(fixture, "vp", [
      "exec",
      "intent",
      "maintainer",
      "setup",
      "--distribution",
      "none",
      "--artifacts",
      "_artifacts",
    ]);
    run(fixture, "vp", [
      "exec",
      "intent",
      "maintainer",
      "add",
      "release-fixture",
      "--domain",
      "fixture",
      "--description",
      "Use when testing generated release reviews.",
      "--source",
      "package.json",
      "--source",
      "src/*.ts",
      "--task",
      "Read the fixture value.",
    ]);
    run(fixture, "git", ["config", "core.hooksPath", "/dev/null"]);
    mkdirSync(nodePath.join(fixture, "src"));
    write(fixture, "src/index.ts", "export const value = 1;\n");
    write(
      fixture,
      "skills/release-fixture/SKILL.md",
      read(fixture, "skills/release-fixture/SKILL.md").replace(
        "<!-- intent:needs-authoring -->",
        "Read src/index.ts and use its exported value."
      )
    );
    for (const path of [
      "_artifacts/domain_map.yaml",
      "_artifacts/skill_spec.md",
      "_artifacts/skill_tree.yaml",
    ]) {
      write(
        fixture,
        path,
        read(fixture, path).replaceAll(
          "<!-- intent:needs-authoring -->",
          "Fixture coverage is complete."
        )
      );
    }
    write(
      fixture,
      ".changeset/release-fixture.md",
      '---\n"release-fixture": minor\n---\n\nPublish the reviewed fixture change.\n'
    );
    write(
      fixture,
      "CHANGELOG.md",
      "# release-fixture\n\n## 0.1.0\n\nInitial fixture.\n"
    );
    intent(fixture, "sync");
    run(fixture, "vp", ["fmt"]);
    commit(fixture);
    intent(
      fixture,
      "review",
      "--unchanged",
      "The fixture exports one constant; its task and planning records cover that value."
    );
    run(fixture, "vp", ["fmt", ".intent/review-state.json"]);
    commit(fixture);
    intent(fixture, "check");
  }, 30_000);

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("records the generated release before and after committing, with explicit and default bases", () => {
    withCheckout((cwd) => {
      run(cwd, "vp", ["run", "version-packages"]);
      expect(JSON.parse(read(cwd, "package.json"))).toMatchObject({
        version: "0.2.0",
      });
      expect(intent(cwd, "check", "--base", "main")).toContain(
        "0 pending review item(s)"
      );
      expect(intent(cwd, "check")).toContain("0 pending review item(s)");
      commit(cwd);
      expect(intent(cwd, "check", "--base", "main")).toContain(
        "0 pending review item(s)"
      );
      expect(intent(cwd, "check")).toContain("0 pending review item(s)");
    });
  }, 30_000);

  it.each([
    "src/index.ts",
    "skills/release-fixture/SKILL.md",
    "package.json",
    "new-api.ts",
  ])(
    "refuses to auto-review a committed substantive change to %s",
    (file) => {
      withCheckout((cwd) => {
        const content =
          file === "new-api.ts" ? "export const extra = 2;\n" : read(cwd, file);
        write(
          cwd,
          file,
          file === "package.json"
            ? content.replace('"0.1.0"', '"0.1.0", "exports": "./src/index.ts"')
            : `${content}\n// An unreviewed change\n`
        );
        commit(cwd);
        const before = read(cwd, ".intent/review-state.json");
        const result = version(cwd);
        expect(result.status).not.toBe(0);
        expect(read(cwd, ".intent/review-state.json")).toBe(before);
        expect(JSON.parse(read(cwd, "package.json"))).toMatchObject({
          version: "0.1.0",
        });
      });
    },
    30_000
  );

  it.each([
    ["release-fixture.md", "Commit: main~1"],
    ["pre/bad.md", "  COMMIT:\nabcdef1"],
    ["release-fixture.md", "PR: #12 commit: not-a-sha"],
  ])(
    "rejects a malformed commit directive in %s before versioning",
    (file, directive) => {
      withCheckout((cwd) => {
        const path = `.changeset/${file}`;
        mkdirSync(nodePath.dirname(nodePath.join(cwd, path)), {
          recursive: true,
        });
        write(
          cwd,
          path,
          `${read(cwd, ".changeset/release-fixture.md")}\n${directive}\n`
        );
        commit(cwd);
        const ci = spawnSync("node", ["scripts/check-changesets.mts"], {
          cwd,
          env: fixtureEnv,
          encoding: "utf-8",
        });
        expect(ci.status).toBe(1);
        expect(ci.stderr).toContain(`${path}: invalid commit directive`);

        const versioning = version(cwd);
        expect(versioning.status).toBe(1);
        expect(versioning.stderr).toContain(
          `${path}: invalid commit directive`
        );
        expect(git(cwd, "status", "--porcelain")).toBe("");
      });
    },
    30_000
  );

  it("accepts hexadecimal commit SHAs and ignores Changesets guidance files", () => {
    withCheckout((cwd) => {
      const path = ".changeset/release-fixture.md";
      write(
        cwd,
        path,
        `${read(cwd, path)}\n  CoMmIt: AbCdef1 with summary text\n\nCommit: later prose\n`
      );
      write(cwd, ".changeset/README.md", "Commit: example only\n");
      expect(run(cwd, "node", ["scripts/check-changesets.mts"])).toBe("");
    });
  });

  it("versions the current checkout with inherited Git context and skips checkout hooks", () => {
    withCheckout((cwd) => {
      const marker = nodePath.join(cwd, ".git", "checkout-hook-ran");
      const hooks = nodePath.join(cwd, ".git", "hooks");
      mkdirSync(hooks, { recursive: true });
      writeFileSync(
        nodePath.join(hooks, "post-checkout"),
        '#!/bin/sh\nprintf "%s\\n" ran > "$FIXTURE_HOOK_MARKER"\n',
        { mode: 0o755 }
      );
      git(cwd, "config", "core.hooksPath", hooks);
      const result = version(cwd, {
        ...fixtureEnv,
        GIT_DIR: nodePath.join(fixture, ".git"),
        GIT_WORK_TREE: fixture,
        GIT_INDEX_FILE: nodePath.join(fixture, ".git/index"),
        GIT_LITERAL_PATHSPECS: "1",
        FIXTURE_HOOK_MARKER: marker,
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(read(cwd, "package.json"))).toMatchObject({
        version: "0.2.0",
      });
      expect(git(fixture, "status", "--porcelain")).toBe("");
      expect(existsSync(marker)).toBe(false);
    });
  }, 30_000);

  it("compares a generated diff greater than one MiB", () => {
    withCheckout((cwd) => {
      const path = ".changeset/release-fixture.md";
      const sample = `${"0123456789".repeat(10)}\n`;
      write(
        cwd,
        path,
        `${read(cwd, path)}\n~~~text\n${sample.repeat(11_000)}~~~\n`
      );
      commit(cwd);
      intent(
        cwd,
        "review",
        "--unchanged",
        "The longer fixture release note describes the same change."
      );
      run(cwd, "vp", ["fmt", ".intent/review-state.json"]);
      commit(cwd);
      run(cwd, "vp", ["run", "version-packages"]);
      expect(read(cwd, "CHANGELOG.md").length).toBeGreaterThan(1024 * 1024);
      expect(git(cwd, "diff", "--cached", "--name-only")).toBe("");
    });
  }, 30_000);

  it("rejects a failed Git diff even when it produced patch bytes", () => {
    withCheckout((cwd) => {
      const env = withCommand(
        cwd,
        "git",
        `
if [ "$1" = diff ] && [ "$4" = --binary ]; then
  "$FIXTURE_COMMAND" "$@" || exit "$?"
  exit 23
fi
exec "$FIXTURE_COMMAND" "$@"
`
      );
      const result = version(cwd, env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("git diff failed (exit 23)");
      expect(git(cwd, "status", "--porcelain")).toBe("");
      expect(version(cwd).status).toBe(0);
    });
  }, 30_000);

  it("retries after validation fails following a recorded Intent review", () => {
    withCheckout((cwd) => {
      const worktrees = git(cwd, "worktree", "list", "--porcelain");
      const env = withCommand(
        cwd,
        "vp",
        `
if [ "$1 $2 $3 $4 $5" = "exec intent maintainer check --base" ]; then
  printf '%s\\n' 'Fixture validation failed after review.' >&2
  exit 23
fi
exec "$FIXTURE_COMMAND" "$@"
`
      );
      const result = version(cwd, env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Fixture validation failed after review."
      );
      expect(git(cwd, "status", "--porcelain")).toBe("");
      expect(git(cwd, "worktree", "list", "--porcelain")).toBe(worktrees);

      run(cwd, "vp", ["run", "version-packages"]);
      expect(intent(cwd, "check")).toContain("0 pending review item(s)");
    });
  }, 30_000);

  it.each([
    {
      report: '{"items":[]}',
      status: 23,
      error: "Fixture review command failed.",
    },
    { report: '{"items":', status: 0, error: "SyntaxError" },
  ])(
    "isolates a failed Intent report capture with exit $status",
    ({ report, status, error }) => {
      withCheckout((cwd) => {
        const worktrees = git(cwd, "worktree", "list", "--porcelain");
        const env = withCommand(
          cwd,
          "vp",
          `
if [ "$1 $2 $3 $4 $5 $7" = "exec intent maintainer review --base --json" ]; then
  printf '%s' '${report}'
  if [ ${status} -ne 0 ]; then
    printf '%s\\n' 'Fixture review command failed.' >&2
  fi
  exit ${status}
fi
exec "$FIXTURE_COMMAND" "$@"
`
        );
        const result = version(cwd, env);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(error);
        expect(git(cwd, "status", "--porcelain")).toBe("");
        expect(git(cwd, "worktree", "list", "--porcelain")).toBe(worktrees);
        expect(version(cwd).status).toBe(0);
      });
    },
    30_000
  );

  it("preserves ignored .env settings for the changelog generator", () => {
    withCheckout((cwd) => {
      write(cwd, ".git/local-excludes", ".env\n");
      git(cwd, "config", "extensions.worktreeConfig", "true");
      git(
        cwd,
        "config",
        "--worktree",
        "core.excludesFile",
        nodePath.join(cwd, ".git/local-excludes")
      );
      write(cwd, ".env", "GITHUB_SERVER_URL=https://fixture.invalid\n");
      const env = withCommand(
        cwd,
        "vp",
        `
if [ "$1 $2 $3" = "exec changeset version" ]; then
  test "$GITHUB_SERVER_URL" = https://fixture.invalid || exit 23
fi
exec "$FIXTURE_COMMAND" "$@"
`
      );
      expect(version(cwd, { ...env, GITHUB_SERVER_URL: "" }).status).toBe(0);
      expect(read(cwd, ".env")).toBe(
        "GITHUB_SERVER_URL=https://fixture.invalid\n"
      );
    });
  }, 30_000);

  it("restores generated paths after patch transfer fails", () => {
    withCheckout((cwd) => {
      const env = withCommand(
        cwd,
        "git",
        `
if [ "$1" = apply ] && [ "$2" = --whitespace=nowarn ]; then
  "$FIXTURE_COMMAND" "$@" || exit "$?"
  exit 23
fi
exec "$FIXTURE_COMMAND" "$@"
`
      );
      const result = version(cwd, env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("git apply --whitespace=nowarn");
      expect(git(cwd, "status", "--porcelain")).toBe("");
      expect(version(cwd).status).toBe(0);
    });
  }, 30_000);

  it("preserves a caller edit during failed patch transfer", () => {
    withCheckout((cwd) => {
      const env = withCommand(
        cwd,
        "git",
        `
if [ "$1" = apply ] && [ "$2" = --whitespace=nowarn ]; then
  "$FIXTURE_COMMAND" "$@" || exit "$?"
  printf '%s\\n' 'Caller edited the changelog.' >> CHANGELOG.md
  printf '%s\\n' 'Caller restored the release note.' > .changeset/release-fixture.md
  exit 23
fi
exec "$FIXTURE_COMMAND" "$@"
`
      );
      const result = version(cwd, env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Git could not restore the checkout");
      expect(git(cwd, "status", "--porcelain")).toBe(
        " M .changeset/release-fixture.md\n M CHANGELOG.md\n"
      );
      expect(read(cwd, "CHANGELOG.md")).toContain(
        "Caller edited the changelog."
      );
    });
  }, 30_000);

  it("refuses a dirty tree before consuming Changesets", () => {
    withCheckout((cwd) => {
      write(cwd, "src/index.ts", "export const value = 2;\n");
      const before = read(cwd, ".intent/review-state.json");
      const result = version(cwd);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("clean working tree");
      expect(read(cwd, ".intent/review-state.json")).toBe(before);
      expect(read(cwd, ".changeset/release-fixture.md")).toContain("minor");
    });
  }, 30_000);

  it("drains multi-megabyte Intent reports and records the generated release", async () => {
    await withCheckout(async (cwd) => {
      const name = "fixture-source-".repeat(14);
      for (let index = 0; index < 3000; index += 1) {
        write(cwd, `src/${name}${index}.ts`, "export const value = 1;\n");
      }
      commit(cwd);

      const cli = nodePath.join(
        repository,
        "node_modules/@tanstack/intent/dist/cli.mjs"
      );
      const options = { cwd, env: fixtureEnv };
      const reportPath = nodePath.join(cwd, ".git", "report.json");
      const expectCompletePipe = async (command: string[], status: number) => {
        const args = [cli, ...command];
        const output = openSync(reportPath, "w");
        try {
          const file = spawnSync(process.execPath, args, {
            ...options,
            stdio: ["ignore", output, "pipe"],
          });
          expect(file.status).toBe(status);
        } finally {
          closeSync(output);
        }
        const expected = readFileSync(reportPath);
        expect(expected.length).toBeGreaterThan(2 * 1024 * 1024);
        expect(() => {
          JSON.parse(expected.toString("utf-8"));
        }).not.toThrow();

        const child = spawn(process.execPath, args, {
          ...options,
          stdio: ["ignore", "pipe", "inherit"],
        });
        const closed = once(child, "close");
        await once(child.stdout, "readable");
        await delay(50);
        const actual = await buffer(child.stdout);
        await expect(closed).resolves.toStrictEqual([status, null]);
        expect(actual).toHaveLength(expected.length);
        expect(actual.equals(expected)).toBe(true);
      };
      await expectCompletePipe(["maintainer", "review", "--json"], 0);
      await expectCompletePipe(["review", "--json", "--check"], 1);

      intent(
        cwd,
        "review",
        "--unchanged",
        "The additional fixture modules export the same constant; guidance and planning still cover the fixture task."
      );
      run(cwd, "vp", ["fmt", ".intent/review-state.json"]);
      commit(cwd);
      run(cwd, "vp", ["run", "version-packages"]);
      expect(intent(cwd, "check", "--base", "main")).toContain(
        "0 pending review item(s)"
      );
      expect(intent(cwd, "check")).toContain("0 pending review item(s)");
    });
  }, 30_000);

  it.each([
    "package.json",
    "src/index.ts",
    "skills/release-fixture/SKILL.md",
    "CHANGELOG.md",
  ])(
    "refuses an unexpected generated edit to %s before recording outcomes",
    (file) => {
      withCheckout((cwd) => {
        write(
          cwd,
          ".changeset/config.json",
          JSON.stringify({
            baseBranch: "main",
            changelog: ["./changelog.mjs", {}],
          })
        );
        write(
          cwd,
          ".changeset/changelog.mjs",
          `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
export default {
  getReleaseLine() {
    const file = ${JSON.stringify(file)};
    if (file === "package.json") {
      const manifest = JSON.parse(readFileSync(file, "utf-8"));
      manifest.exports = "./src/index.ts";
      writeFileSync(file, JSON.stringify(manifest));
    } else {
      appendFileSync(file, "\\n// Unexpected generated edit.\\n");
    }
    return "Generated fixture release.";
  },
  getDependencyReleaseLine() { return ""; },
};
`
        );
        run(cwd, "vp", ["fmt"]);
        commit(cwd);
        intent(
          cwd,
          "review",
          "--unchanged",
          "The fixture changelog injects an edit to test the release guard; consumer guidance is unchanged."
        );
        run(cwd, "vp", ["fmt", ".intent/review-state.json"]);
        commit(cwd);
        const before = read(cwd, ".intent/review-state.json");
        const result = version(cwd);
        expect(result.status).not.toBe(0);
        expect(read(cwd, ".intent/review-state.json")).toBe(before);
        expect(git(cwd, "status", "--porcelain")).toBe("");
        expect(result.stderr).toMatch(
          /Only the root package version|Unexpected versioning change|preserve existing changelog/u
        );
      });
    },
    30_000
  );

  it("leaves later source changes pending after a generated release review", () => {
    withCheckout((cwd) => {
      run(cwd, "vp", ["run", "version-packages"]);
      write(cwd, "src/index.ts", "export const value = 2;\n");
      const result = spawnSync(
        "vp",
        ["exec", "intent", "maintainer", "check", "--base", "main"],
        { cwd, env: fixtureEnv, encoding: "utf-8" }
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("changed src/index.ts");
    });
  }, 30_000);
});
