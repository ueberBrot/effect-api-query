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
const fixture = mkdtempSync(nodePath.join(tmpdir(), "version-packages-"));
const run = (cwd: string, command: string, args: string[]) =>
  execFileSync(command, args, {
    cwd,
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

const withCheckout = (test: (cwd: string) => void) => {
  const cwd = mkdtempSync(nodePath.join(tmpdir(), "version-packages-case-"));
  try {
    git(cwd, "clone", "--shared", fixture, ".");
    git(cwd, "config", "user.name", "Release test");
    git(cwd, "config", "user.email", "release-test@example.invalid");
    symlinkSync(
      nodePath.join(repository, "node_modules"),
      nodePath.join(cwd, "node_modules")
    );
    test(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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
    // The default changelog is local: integration tests need no GitHub credential.
    mkdirSync(nodePath.join(fixture, "scripts"));
    cpSync(
      nodePath.join(repository, "scripts/version-packages.mts"),
      nodePath.join(fixture, "scripts/version-packages.mts")
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
        const result = spawnSync("vp", ["run", "version-packages"], {
          cwd,
          encoding: "utf-8",
        });
        expect(result.status).not.toBe(0);
        expect(read(cwd, ".intent/review-state.json")).toBe(before);
        expect(JSON.parse(read(cwd, "package.json"))).toMatchObject({
          version: "0.1.0",
        });
      });
    },
    30_000
  );

  it("refuses a dirty tree before consuming Changesets", () => {
    withCheckout((cwd) => {
      write(cwd, "src/index.ts", "export const value = 2;\n");
      const before = read(cwd, ".intent/review-state.json");
      const result = spawnSync("vp", ["run", "version-packages"], {
        cwd,
        encoding: "utf-8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("clean working tree");
      expect(read(cwd, ".intent/review-state.json")).toBe(before);
      expect(read(cwd, ".changeset/release-fixture.md")).toContain("minor");
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
        const result = spawnSync("vp", ["run", "version-packages"], {
          cwd,
          encoding: "utf-8",
        });
        expect(result.status).not.toBe(0);
        expect(read(cwd, ".intent/review-state.json")).toBe(before);
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
        { cwd, encoding: "utf-8" }
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("changed src/index.ts");
    });
  }, 30_000);
});
