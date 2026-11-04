import { ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import manifest from "../package.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf-8");
const floor = /^>=(?<version>\d+\.\d+\.\d+) </u.exec(
  manifest.peerDependencies.effect
)?.groups?.["version"];
const current = /^ {2}effect: (?<version>\d+\.\d+\.\d+)$/mu.exec(workspace)
  ?.groups?.["version"];
ok(
  floor !== undefined && current !== undefined,
  "Expected explicit Effect versions."
);
const keep = process.argv.slice(2).includes("--keep");
const artifacts = path.join(root, ".artifacts");
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(path.join(artifacts, "effect-compatibility-"));
const tests = [
  "create-rpc-query-utils-execution",
  "create-rpc-query-utils-streaming",
  "create-rpc-query-utils-server-local",
  "http-execution",
  "http-transport-cancellation",
  "http-hydration",
  "http-semantic-keys",
  "stream-snapshot",
].map((name) => `tests/${name}.test.ts`);
const run = (args: string[], cwd: string) =>
  execFileSync("vp", args, { cwd, stdio: "inherit" });

try {
  execFileSync(
    "vp",
    ["pm", "pack", "--pack-destination", directory, "--", "--ignore-scripts"],
    { cwd: root, stdio: ["ignore", "pipe", "inherit"] }
  );
  const tarballs = readdirSync(directory).filter((entry) =>
    entry.endsWith(".tgz")
  );
  ok(tarballs.length === 1, "Expected one packed library tarball.");
  const [tarball] = tarballs;
  ok(tarball !== undefined, "Expected the packed library tarball.");

  for (const version of new Set([floor, current])) {
    console.log(`Checking packed consumers with Effect ${version}`);
    const consumer = path.join(directory, version);
    mkdirSync(consumer);
    for (const entry of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "examples",
      "apps/docs/package.json",
      "tests/types",
      "tests/fixtures",
      ...tests,
    ]) {
      cpSync(path.join(root, entry), path.join(consumer, entry), {
        recursive: true,
        filter: (source) =>
          !["node_modules", "dist", ".vite"].includes(path.basename(source)),
      });
    }
    run(
      [
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--prefer-offline",
        "--silent",
      ],
      consumer
    );
    for (const application of ["vite-react", "tanstack-start"]) {
      rmSync(path.join(consumer, "examples", application, "package.json"));
      rmSync(path.join(consumer, "examples", application, "node_modules"), {
        recursive: true,
        force: true,
      });
    }
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "effect-api-query-effect-consumer",
        private: true,
        type: "module",
        packageManager: manifest.packageManager,
        imports: { "#effect-api-query": manifest.name },
        devDependencies: {
          ...manifest.devDependencies,
          "@effect/vitest": version,
        },
      })
    );
    writeFileSync(
      path.join(consumer, "pnpm-workspace.yaml"),
      workspace
        .replace(/^ {2}effect: .+$/mu, `  effect: ${version}`)
        .replace(
          /^ {2}"@effect\/platform-node": .+$/mu,
          `  "@effect/platform-node": ${version}`
        )
        .replace(
          /^overrides:$/mu,
          `overrides:\n  "@effect/platform-node-shared": ${version}`
        )
    );
    run(
      [
        "add",
        "--save-dev",
        "--workspace-root",
        "--ignore-scripts",
        "--prefer-offline",
        "--silent",
        path.join(directory, tarball),
      ],
      consumer
    );
    run(
      [
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--prefer-offline",
        "--silent",
      ],
      consumer
    );
    const installedEffect = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "import { getCurrentVersion } from 'effect/Version'; process.stdout.write(getCurrentVersion())",
      ],
      { cwd: consumer, encoding: "utf-8" }
    );
    ok(
      installedEffect === version,
      `Expected Effect ${version}, received ${installedEffect}.`
    );
    const library = path.join(consumer, "node_modules", manifest.name);
    ok(
      !existsSync(path.join(library, "src")),
      "Consumers must use the packed library."
    );
    const resolvedEffect = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "process.stdout.write(import.meta.resolve('effect'))",
      ],
      { cwd: realpathSync(library), encoding: "utf-8" }
    );
    ok(
      resolvedEffect.includes(`/effect@${version}/`),
      "The packed library must resolve the selected Effect peer."
    );
    for (const compiler of ["typescript", "typescript-5.9"]) {
      console.log(
        `Checking public compiler fixtures: Effect ${version}, ${compiler}`
      );
      execFileSync(
        process.execPath,
        [
          path.join(consumer, "node_modules", compiler, "bin/tsc"),
          "--project",
          "tests/types/tsconfig.json",
          "--pretty",
          "false",
        ],
        { cwd: consumer, stdio: "inherit" }
      );
    }
    writeFileSync(
      path.join(consumer, "vite.config.ts"),
      `import { defineConfig } from "vite-plus";\nexport default defineConfig({ test: { include: ${JSON.stringify(tests)} } });\n`
    );
    execFileSync(path.join(consumer, "node_modules/.bin/vp"), ["test"], {
      cwd: consumer,
      stdio: "inherit",
    });
  }
} finally {
  if (keep) {
    console.log(`Effect compatibility consumer directory: ${directory}`);
  } else {
    rmSync(directory, { recursive: true, force: true });
  }
}
