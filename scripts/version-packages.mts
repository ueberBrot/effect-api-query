import { deepStrictEqual, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { parseEnv } from "node:util";

import { checkChangesets } from "./check-changesets.mts";
import { capture, run as runCommand } from "./lib/exec.mts";
import { withVersioningCheckout } from "./lib/versioning-checkout.mts";

/* oxlint-disable anti-slop/no-runtime-typeof -- Parse the package manifest at the JSON input boundary. */
const manifest = (read: (path: string) => string) => {
  const value: unknown = JSON.parse(read("package.json"));
  ok(
    value !== null &&
      typeof value === "object" &&
      "version" in value &&
      typeof value.version === "string",
    "Expected a package manifest with a version."
  );
  return { ...value, version: value.version };
};

/* oxlint-enable anti-slop/no-runtime-typeof */

const changelogEnvironment = (source: string, env: NodeJS.ProcessEnv) => {
  let content: string;
  try {
    content = readFileSync(nodePath.join(source, ".env"), "utf-8");
  } catch {
    return env;
  }

  const file = parseEnv(content);
  const merged = { ...env };
  for (const name of [
    "GITHUB_GRAPHQL_URL",
    "GITHUB_REPOSITORY",
    "GITHUB_SERVER_URL",
    "GITHUB_TOKEN",
  ]) {
    if (merged[name] === undefined || merged[name] === "") {
      merged[name] = file[name];
    }
  }
  return merged;
};

await withVersioningCheckout(async (checkout) => {
  const { base, options, source, digestGeneratedPatch } = checkout;
  const git = (...args: string[]) => capture("git", args, options);
  const run = (args: readonly string[]) => {
    runCommand("vp", args, options);
  };
  const read = (path: string) =>
    readFileSync(nodePath.resolve(options.cwd, path), "utf-8");
  await checkChangesets(options.cwd);
  run(["exec", "intent", "maintainer", "check"]);
  const { version: previousVersion, ...previousMetadata } = manifest(read);
  const previousChangelog = read("CHANGELOG.md");
  const checkGitState = () => {
    ok(git("rev-parse", "HEAD").trim() === base, "Versioning changed HEAD.");
    ok(
      !git("diff", "--cached", "--name-only").trim(),
      "Versioning changed the Git index."
    );
    ok(
      !/^ mode change /mu.test(git("diff", "--summary", base)),
      "Versioning changed file modes."
    );
    ok(
      !git("ls-files", "--others", "--exclude-standard").trim(),
      "Versioning created unexpected untracked files."
    );
  };
  runCommand("vp", ["exec", "changeset", "version"], {
    ...options,
    env: changelogEnvironment(source, options.env),
  });
  run(["fmt"]);
  checkGitState();
  const patchDigest = await digestGeneratedPatch();

  const changes = git("diff", "--no-renames", "--name-status", "-z", base)
    .split("\0")
    .filter(Boolean);
  const generated = new Set<string>();
  for (let index = 0; index < changes.length; index += 2) {
    const status = changes[index];
    const path = changes[index + 1] ?? "";
    ok(
      (status === "M" && ["package.json", "CHANGELOG.md"].includes(path)) ||
        (status === "D" &&
          /^\.changeset\/[^/]+\.md$/u.test(path) &&
          path !== ".changeset/README.md"),
      `Unexpected versioning change: ${status} ${path}`
    );
    generated.add(path);
  }

  if (generated.size > 0) {
    const { version, ...metadata } = manifest(read);
    deepStrictEqual(
      metadata,
      previousMetadata,
      "Only the root package version may change during release generation."
    );
    ok(
      version !== previousVersion &&
        /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(version),
      "Expected a generated package version."
    );
    ok(
      generated.has("package.json") && generated.has("CHANGELOG.md"),
      "Expected both a version bump and a generated changelog."
    );
    const changelog = read("CHANGELOG.md");
    const titleEnd = previousChangelog.indexOf("\n");
    ok(
      titleEnd !== -1 &&
        changelog.startsWith(previousChangelog.slice(0, titleEnd)) &&
        changelog.endsWith(previousChangelog.slice(titleEnd)) &&
        changelog.includes(`\n## ${version}\n`),
      "Release generation must preserve existing changelog entries."
    );

    const output = execFileSync(
      "vp",
      ["exec", "intent", "maintainer", "review", "--base", base, "--json"],
      {
        ...options,
        encoding: "utf-8",
        maxBuffer: Infinity,
        stdio: ["ignore", "pipe", "inherit"],
      }
    );
    /* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters -- Parse the installed Intent CLI JSON at the input boundary. */
    const input: unknown = JSON.parse(output);
    ok(
      input !== null &&
        typeof input === "object" &&
        "items" in input &&
        Array.isArray(input.items),
      "Expected an Intent review report."
    );
    const report = {
      ...input,
      items: input.items.map((item: unknown) => {
        ok(
          item !== null &&
            typeof item === "object" &&
            "id" in item &&
            typeof item.id === "string" &&
            "kind" in item &&
            typeof item.kind === "string" &&
            "path" in item &&
            typeof item.path === "string" &&
            "changedFiles" in item &&
            Array.isArray(item.changedFiles) &&
            "problems" in item &&
            Array.isArray(item.problems),
          "Expected a native Intent review item."
        );
        return {
          ...item,
          id: item.id,
          kind: item.kind,
          path: item.path,
          changedFiles: item.changedFiles.map(String),
          problemCount: item.problems.length,
        };
      }),
    };
    /* oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters */
    const reviewed = report.items.map((item) => {
      ok(
        item.problemCount === 0 &&
          item.changedFiles.length > 0 &&
          item.changedFiles.every((path) => generated.has(path)),
        `Release generation cannot review unrelated work: ${item.id}`
      );
      ok(
        (item.kind === "source" && generated.has(item.path)) ||
          (["skill", "planning"].includes(item.kind) &&
            item.changedFiles.every((path) => path === "package.json")),
        `Unexpected release review item: ${item.id}`
      );
      return {
        ...item,
        outcome: "no-change",
        reason:
          item.kind === "source"
            ? "Changesets generated this release changelog or consumed its release notes; the reviewed implementation and consumer guidance are unchanged."
            : "Only the package version changed. Shipped guidance and all three planning records retain their reviewed tasks, source mappings, and behavior.",
        evidence: [
          `Before versioning: intent maintainer check passed at ${base}.`,
          `changeset version and vp fmt generated ${previousVersion} -> ${version}.`,
          "Verified that all manifest fields except version and all existing changelog entries are unchanged; other generated changes are only consumed .changeset/*.md deletions.",
          `Scoped generated changes: ${item.changedFiles.join(", ")}.`,
        ],
      };
    });
    const directory = mkdtempSync(
      nodePath.join(tmpdir(), "release-intent-review-")
    );
    try {
      const reportPath = nodePath.join(directory, "review.json");
      writeFileSync(reportPath, JSON.stringify({ ...report, items: reviewed }));
      run(["exec", "intent", "maintainer", "review", "--record", reportPath]);
      run(["fmt", ".intent/review-state.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  run(["exec", "intent", "maintainer", "check", "--base", base]);
  run(["exec", "intent", "maintainer", "check"]);
  checkGitState();
  ok(
    (await digestGeneratedPatch()) === patchDigest,
    "The generated release changed during Intent review."
  );
});
