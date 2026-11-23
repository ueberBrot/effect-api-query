import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Predicate } from "effect";
import { describe, expect, it } from "vitest";

import manifest from "../package.json" with { type: "json" };
import { currentCompiler } from "../scripts/compiler.mts";
import { readWorkflow, workflowValue } from "./fixtures/workflow";

const script = path.resolve(
  import.meta.dirname,
  "../scripts/check-workflow.mts"
);
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
const write = (cwd: string, file: string, content = "fixture\n") => {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), content);
};
const save = (cwd: string) => {
  git(cwd, "add", ".");
  git(cwd, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "Fixture");
  return git(cwd, "rev-parse", "HEAD");
};
const withRepository = (run: (cwd: string, base: string) => void) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "workflow-guards-"));
  try {
    git(cwd, "init", "-q", "--initial-branch=main");
    git(cwd, "config", "user.name", "Fixture");
    git(cwd, "config", "user.email", "fixture@example.invalid");
    write(cwd, "README.md");
    const base = save(cwd);
    git(cwd, "update-ref", "refs/remotes/origin/main", base);
    write(cwd, ".git/bin/gh", '#!/bin/sh\nprintf "%s\\n" "$PR_STATE"\n');
    write(
      cwd,
      ".git/bin/vp",
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$WORKFLOW_LOG"\n'
    );
    chmodSync(path.join(cwd, ".git/bin/gh"), 0o755);
    chmodSync(path.join(cwd, ".git/bin/vp"), 0o755);
    run(cwd, base);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};
const check = (
  cwd: string,
  args: string[] = [],
  input = "",
  state = "false\tfalse"
) =>
  spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), script, ...args],
    {
      cwd,
      input,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${path.join(cwd, ".git/bin")}${path.delimiter}${process.env["PATH"] ?? ""}`,
        PR_STATE: state,
        WORKFLOW_LOG: path.join(cwd, ".git/checks"),
      },
    }
  );
const push = (cwd: string, base: string, state?: string, deletion = false) =>
  check(
    cwd,
    ["--push", "origin", "git@github.com:owner/repo.git"],
    `refs/heads/main ${deletion ? "0".repeat(40) : git(cwd, "rev-parse", "HEAD")} refs/heads/topic ${base}\n`,
    state
  );

describe("repository workflow guards", () => {
  it("pins the Playwright image to the package version and a digest", () => {
    const workflow = readWorkflow("playwright");
    const image = workflowValue(workflow, [
      "jobs",
      "shards",
      "container",
      "image",
    ]);
    const reference =
      /^mcr\.microsoft\.com\/playwright:v(?<version>[^\s-]+)-noble@sha256:[\da-f]{64}$/u;
    expect(
      Predicate.isString(image)
        ? reference.exec(image)?.groups?.["version"]
        : undefined
    ).toBe(manifest.devDependencies["@playwright/test"]);
  });

  it("starts PR browser jobs independently and tests the prepared artifacts for releases", () => {
    const workflow = readWorkflow("ci");
    const pullRequest = "browser-shards";
    const artifacts = "browser-shards-from-artifacts";
    expect({
      runLocally: workflowValue(workflow, [
        "jobs",
        pullRequest,
        "with",
        "build-locally",
      ]),
      pullRequestWhen: workflowValue(workflow, ["jobs", pullRequest, "if"]),
      pullRequestNeeds: workflowValue(workflow, ["jobs", pullRequest, "needs"]),
      useArtifacts: workflowValue(workflow, [
        "jobs",
        artifacts,
        "with",
        "build-locally",
      ]),
      artifactsWhen: workflowValue(workflow, ["jobs", artifacts, "if"]),
    }).toStrictEqual({
      runLocally: true,
      pullRequestWhen: "github.event_name == 'pull_request'",
      pullRequestNeeds: undefined,
      useArtifacts: false,
      artifactsWhen: "github.event_name != 'pull_request'",
    });
    expect(workflowValue(workflow, ["jobs", artifacts, "needs"])).toStrictEqual(
      expect.arrayContaining(["example-builds", "documentation"])
    );
  });

  it.each([
    "_artifacts/review.md",
    ".artifacts/output.json",
    "reports/result.html",
    "PLAN.md",
  ])("rejects tracked session output: %s", (file) => {
    withRepository((cwd) => {
      write(cwd, file);
      git(cwd, "add", ".");
      const result = check(cwd, ["--staged"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(file);
    });
  });

  it("stops the commit hook before formatting forbidden staged output", () => {
    withRepository((cwd) => {
      write(cwd, "PLAN.md");
      git(cwd, "add", "PLAN.md");
      mkdirSync(path.join(cwd, "scripts/lib"), { recursive: true });
      cpSync(script, path.join(cwd, "scripts/check-workflow.mts"));
      cpSync(
        path.resolve(import.meta.dirname, "../scripts/lib/exec.mts"),
        path.join(cwd, "scripts/lib/exec.mts")
      );
      symlinkSync(
        path.resolve(import.meta.dirname, "../node_modules"),
        path.join(cwd, "node_modules")
      );
      const result = spawnSync(
        "sh",
        [path.resolve(import.meta.dirname, "../.vite-hooks/pre-commit")],
        {
          cwd,
          encoding: "utf-8",
          env: {
            ...process.env,
            PATH: `${path.join(cwd, ".git/bin")}${path.delimiter}${process.env["PATH"] ?? ""}`,
            WORKFLOW_LOG: path.join(cwd, ".git/checks"),
          },
        }
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("PLAN.md");
      expect(existsSync(path.join(cwd, ".git/checks"))).toBe(false);
    });
  });

  it("allows maintained docs and the three Intent records", () => {
    withRepository((cwd) => {
      for (const file of [
        "docs/agents/example.md",
        "_artifacts/domain_map.yaml",
        "_artifacts/skill_spec.md",
        "_artifacts/skill_tree.yaml",
      ]) {
        write(cwd, file);
      }
      expect(check(cwd).status).toBe(0);
    });
  });

  it("blocks a merged branch before running checks", () => {
    withRepository((cwd, base) => {
      write(cwd, "vite.config.ts", "export default {};\n");
      save(cwd);
      const result = push(cwd, base, "false\ttrue");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("already merged");
      expect(existsSync(path.join(cwd, ".git/checks"))).toBe(false);
    });
  });

  it("runs checkout tests for config changes and compatibility for workspace changes", () => {
    withRepository((cwd, base) => {
      write(cwd, "vite.config.ts", "export default {};\n");
      write(cwd, "examples/shared/package.json", "{}\n");
      save(cwd);
      expect(push(cwd, base).status).toBe(0);
      expect(
        readFileSync(path.join(cwd, ".git/checks"), "utf-8")
          .split("\n")
          .filter(Boolean)
      ).toStrictEqual([
        "test -- tests/skills-maintenance.test.ts tests/workflow-guards.test.ts",
        "run effect-compatibility",
      ]);
    });
  });

  it("allows an open replacement PR and skips expensive checks for docs", () => {
    withRepository((cwd, base) => {
      write(cwd, "docs/example.md");
      save(cwd);
      expect(push(cwd, base, "true\ttrue").status).toBe(0);
      expect(existsSync(path.join(cwd, ".git/checks"))).toBe(false);
    });
  });

  it("rejects dirty checkouts rather than validating unpushed edits", () => {
    withRepository((cwd, base) => {
      write(cwd, "README.md", "changed\n");
      const result = push(cwd, base);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Commit or stash");
    });
  });

  it("fails closed when PR state is unavailable", () => {
    withRepository((cwd, base) => {
      expect(push(cwd, base, "unavailable").status).toBe(1);
    });
  });

  it("allows deleting a merged branch", () => {
    withRepository((cwd, base) => {
      expect(push(cwd, base, "false\ttrue", true).status).toBe(0);
    });
  });

  it("checks a new branch against main", () => {
    withRepository((cwd) => {
      write(cwd, "package.json", "{}\n");
      save(cwd);
      expect(push(cwd, "0".repeat(40)).status).toBe(0);
      expect(readFileSync(path.join(cwd, ".git/checks"), "utf-8")).toContain(
        "effect-compatibility"
      );
    });
  });
});

describe("example import ownership", () => {
  it("rejects cross-app private imports while accepting the shared package", () => {
    const repository = path.resolve(import.meta.dirname, "..");
    for (const [host, source, forbidden] of [
      [
        "tanstack-start",
        'import "../../../../vite-react/src/main.tsx";\n',
        true,
      ],
      [
        "vite-react",
        'import "../../../../tanstack-start/src/router.tsx";\n',
        true,
      ],
      [
        "vite-react",
        'export { describeEffectError } from "@effect-api-query/shared/error-description.ts";\n',
        false,
      ],
    ] as const) {
      const directory = mkdtempSync(
        path.join(repository, `examples/${host}/src/lint-fixture-`)
      );
      const file = path.join(directory, "probe.ts");
      try {
        writeFileSync(file, source);
        const result = spawnSync(
          process.execPath,
          [
            path.join(
              repository,
              "node_modules/@effect/tsgo/dist/effect-tsgo.cjs"
            ),
            `--tsrs-lint=${currentCompiler.engineVersion}`,
            "vp",
            "lint",
            "--no-ignore",
            file,
          ],
          {
            cwd: repository,
            encoding: "utf-8",
          }
        );
        expect(result.status).toBe(forbidden ? 1 : 0);
        expect(
          (result.stdout + result.stderr).includes("no-restricted-imports")
        ).toBe(forbidden);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }, 30_000);
});
