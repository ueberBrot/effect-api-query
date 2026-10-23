import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repository = nodePath.resolve(import.meta.dirname, "..");
const fixture = mkdtempSync(nodePath.join(tmpdir(), "skills-maintenance-"));
const workflow = ".github/workflows/ci.yml";
const reviewState = ".intent/review-state.json";
const skill = "skills/maintenance-fixture/SKILL.md";
const environment = (overrides: NodeJS.ProcessEnv = {}) => ({
  ...process.env,
  GITHUB_ACTIONS: "false",
  GITHUB_STEP_SUMMARY: "",
  INTENT_REVIEW_BASE: "",
  ...overrides,
});
const run = (cwd: string, command: string, args: string[]) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf-8",
    env: environment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
const git = (cwd: string, ...args: string[]) => run(cwd, "git", args);
const intent = (cwd: string, ...args: string[]) =>
  run(cwd, "vp", ["exec", "intent", "maintainer", ...args]);
const check = (cwd: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync("vp", ["run", "skills-maintenance-check"], {
    cwd,
    encoding: "utf-8",
    env: environment(env),
  });
const read = (cwd: string, file: string) =>
  readFileSync(nodePath.join(cwd, file), "utf-8");
const write = (cwd: string, file: string, content: string) => {
  writeFileSync(nodePath.join(cwd, file), content);
};
const commit = (cwd: string) => {
  git(cwd, "add", ".");
  git(cwd, "-c", "core.hooksPath=/dev/null", "commit", "-m", "Fixture");
};
const changeWorkflow = (cwd: string) => {
  write(
    cwd,
    workflow,
    read(cwd, workflow).replace("timeout-minutes: 5", "timeout-minutes: 10")
  );
  commit(cwd);
};
const withCheckout = (test: (cwd: string) => void) => {
  const cwd = mkdtempSync(nodePath.join(tmpdir(), "skills-maintenance-case-"));
  try {
    git(cwd, "clone", "--shared", fixture, ".");
    git(cwd, "config", "user.name", "Maintenance test");
    git(cwd, "config", "user.email", "maintenance-test@example.invalid");
    symlinkSync(
      nodePath.join(repository, "node_modules"),
      nodePath.join(cwd, "node_modules")
    );
    test(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

describe("Intent maintenance validation", () => {
  beforeAll(() => {
    git(fixture, "init", "--initial-branch=main");
    git(fixture, "config", "user.name", "Maintenance test");
    git(fixture, "config", "user.email", "maintenance-test@example.invalid");
    git(fixture, "config", "core.hooksPath", "/dev/null");
    symlinkSync(
      nodePath.join(repository, "node_modules"),
      nodePath.join(fixture, "node_modules")
    );
    write(fixture, ".gitignore", "node_modules\n.vite\n");
    write(
      fixture,
      "package.json",
      JSON.stringify({
        name: "maintenance-fixture",
        version: "0.1.0",
        type: "module",
        files: ["src", "skills"],
        packageManager: "pnpm@12.13.0",
      })
    );
    for (const file of [
      "vite.config.ts",
      "scripts/check-skills.sh",
      ".vite-hooks/pre-push",
    ]) {
      mkdirSync(nodePath.dirname(nodePath.join(fixture, file)), {
        recursive: true,
      });
      cpSync(nodePath.join(repository, file), nodePath.join(fixture, file));
    }
    intent(
      fixture,
      "setup",
      "--distribution",
      "none",
      "--artifacts",
      "_artifacts"
    );
    intent(
      fixture,
      "add",
      "maintenance-fixture",
      "--domain",
      "fixture",
      "--description",
      "Use when reading the fixture value.",
      "--source",
      "src/index.ts",
      "--task",
      "Read the fixture value."
    );
    mkdirSync(nodePath.join(fixture, "src"));
    write(fixture, "src/index.ts", "export const value = 1;\n");
    write(
      fixture,
      skill,
      read(fixture, skill).replace(
        "<!-- intent:needs-authoring -->",
        "Read src/index.ts and use its exported value."
      )
    );
    for (const file of [
      "_artifacts/domain_map.yaml",
      "_artifacts/skill_spec.md",
      "_artifacts/skill_tree.yaml",
    ]) {
      write(
        fixture,
        file,
        read(fixture, file).replaceAll(
          "<!-- intent:needs-authoring -->",
          "The fixture task reads the one exported constant."
        )
      );
    }
    write(
      fixture,
      workflow,
      "name: Fixture CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: echo fixture\n"
    );
    intent(fixture, "sync");
    commit(fixture);
    intent(
      fixture,
      "review",
      "--unchanged",
      "The fixture exports one constant; its authored skill and three planning records cover reading that value."
    );
    commit(fixture);
    intent(fixture, "check");
  }, 30_000);

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("rejects an unreviewed CI-only change and passes after an explicit reasoned review", () => {
    withCheckout((cwd) => {
      run(cwd, "vp", ["run", "skills-maintenance-check"]);
      changeWorkflow(cwd);
      run(cwd, "vp", ["run", "skills-check"]);
      const before = read(cwd, reviewState);
      const summary = nodePath.join(cwd, ".git/intent-summary.md");
      const result = check(cwd, { GITHUB_STEP_SUMMARY: summary });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`Review unmapped change ${workflow}`);
      expect(read(cwd, reviewState)).toBe(before);
      expect(readFileSync(summary, "utf-8")).toContain(
        `Review unmapped change ${workflow}`
      );

      intent(
        cwd,
        "review",
        "--base",
        "origin/main",
        "--unchanged",
        "Only the CI timeout increases from five to ten minutes; the exported constant and the skill's task remain unchanged. Structural skill validation passed."
      );
      expect(check(cwd).status).toBe(0);
      run(cwd, "sh", [".vite-hooks/pre-push"]);
    });
  }, 30_000);

  it.each([
    ["validate", "vp", ["run", "validate"]],
    ["pre-push", "sh", [".vite-hooks/pre-push"]],
  ])(
    "blocks %s on the pending CI review without recording an outcome",
    (_name, command, args) => {
      withCheckout((cwd) => {
        changeWorkflow(cwd);
        const before = read(cwd, reviewState);
        const result = spawnSync(command, args, {
          cwd,
          encoding: "utf-8",
          env: environment(),
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(`Review unmapped change ${workflow}`);
        expect(read(cwd, reviewState)).toBe(before);
      });
    },
    30_000
  );

  it("honors an explicit PR base even when local main already contains the change", () => {
    withCheckout((cwd) => {
      const base = git(cwd, "rev-parse", "HEAD").trim();
      changeWorkflow(cwd);
      git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
      expect(check(cwd).status).toBe(0);
      const before = read(cwd, reviewState);
      const result = check(cwd, {
        GITHUB_ACTIONS: "true",
        INTENT_REVIEW_BASE: base,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`Review unmapped change ${workflow}`);
      expect(read(cwd, reviewState)).toBe(before);
      expect(check(cwd, { INTENT_REVIEW_BASE: "HEAD" }).status).toBe(0);
    });
  }, 30_000);

  it("uses the local merge-base without requiring a review of changes only on origin/main", () => {
    withCheckout((cwd) => {
      git(cwd, "checkout", "-b", "upstream");
      changeWorkflow(cwd);
      git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
      git(cwd, "checkout", "main");
      const before = read(cwd, reviewState);
      expect(check(cwd).status).toBe(0);
      expect(read(cwd, reviewState)).toBe(before);
      const result = check(cwd, { INTENT_REVIEW_BASE: "origin/main" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`Review unmapped change ${workflow}`);
    });
  }, 30_000);

  it("preserves Intent's recorded baseline on GitHub Actions without an explicit base", () => {
    withCheckout((cwd) => {
      git(cwd, "update-ref", "-d", "refs/remotes/origin/main");
      expect(check(cwd, { GITHUB_ACTIONS: "true" }).status).toBe(0);
      changeWorkflow(cwd);
      const before = read(cwd, reviewState);
      const result = check(cwd, { GITHUB_ACTIONS: "true" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`Review unmapped change ${workflow}`);
      expect(read(cwd, reviewState)).toBe(before);
    });
  }, 30_000);

  it("fails with recovery instructions when the local review base is unavailable", () => {
    withCheckout((cwd) => {
      git(cwd, "update-ref", "-d", "refs/remotes/origin/main");
      intent(cwd, "check");
      const before = read(cwd, reviewState);
      const result = check(cwd);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("git fetch origin main");
      expect(result.stderr).toContain("INTENT_REVIEW_BASE");
      expect(read(cwd, reviewState)).toBe(before);
      expect(check(cwd, { INTENT_REVIEW_BASE: "HEAD" }).status).toBe(0);
    });
  }, 30_000);
});
