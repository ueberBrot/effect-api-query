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
import { compilerCommand, currentCompiler } from "./compiler.mts";

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
const queryFloor = /^>=(?<version>\d+\.\d+\.\d+) </u.exec(
  manifest.peerDependencies["@tanstack/query-core"]
)?.groups?.["version"];
const queryCurrent =
  /^ {2}"@tanstack\/query-core": (?<version>\d+\.\d+\.\d+)$/mu.exec(workspace)
    ?.groups?.["version"];
ok(
  queryFloor !== undefined && queryCurrent !== undefined,
  "Expected explicit Query Core versions."
);
// Reviewed, age-eligible representatives; do not discover latest during CI.
// Revisit these pins and each admitted minor when reviewing the peer range.
const effectVersions = new Set([floor, "4.0.7", current, "4.1.2"]);
ok(
  manifest.peerDependencies.effect === ">=4.0.6 <4.2.0",
  "Review the Effect minor matrix when changing support."
);
const keep = process.argv.slice(2).includes("--keep");
const artifacts = path.join(root, ".artifacts");
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(path.join(artifacts, "effect-compatibility-"));
const tests = [
  "create-rpc-query-utils-execution",
  "create-rpc-query-utils-streaming",
  "create-rpc-query-utils-stream-publication",
  "create-rpc-query-utils-stream-hashing",
  "create-rpc-query-utils-keys",
  "stream-publication",
  "create-rpc-query-utils-stream-cache",
  "create-rpc-query-utils-server-local",
  "http-execution",
  "http-transport-cancellation",
  "http-hydration",
  "http-cached-views",
  "http-live-query",
  "http-metadata-options",
  "http-ndjson-query",
  "http-semantic-keys",
  "http-structural-sharing",
  "hydration-codecs",
  "stream-snapshot",
  "query-effects",
  "query-owner",
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

  for (const version of effectVersions) {
    for (const queryVersion of new Set([queryFloor, queryCurrent])) {
      console.log(
        `Checking packed consumers with Effect ${version}, Query Core ${queryVersion}`
      );
      const consumer = path.join(directory, `${version}-query-${queryVersion}`);
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
          .replace(
            /^ {2}"@tanstack\/query-core": .+$/mu,
            `  "@tanstack/query-core": ${queryVersion}`
          )
          .replace(
            /^ {2}"@tanstack\/react-query": .+$/mu,
            `  "@tanstack/react-query": ${queryVersion}`
          )
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
      // Resolve from the packed package itself, and compare with the consumer.
      // Merely checking the root install can conceal a second peer instance.
      for (const peer of ["effect", "@tanstack/query-core"]) {
        const resolve = (cwd: string) =>
          execFileSync(
            process.execPath,
            [
              "--input-type=module",
              "--eval",
              `process.stdout.write(import.meta.resolve(${JSON.stringify(peer)}))`,
            ],
            { cwd, encoding: "utf-8" }
          );
        ok(
          resolve(realpathSync(library)) === resolve(consumer),
          `Packed ${peer} must share the consumer peer instance.`
        );
      }
      const installedQuery = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          "import manifest from '@tanstack/query-core/package.json' with { type: 'json' }; process.stdout.write(manifest.version)",
        ],
        { cwd: consumer, encoding: "utf-8" }
      );
      ok(
        installedQuery === queryVersion,
        `Expected Query Core ${queryVersion}.`
      );
      const resolvedLibrary = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `process.stdout.write(import.meta.resolve(${JSON.stringify(manifest.name)}))`,
        ],
        { cwd: consumer, encoding: "utf-8" }
      );
      ok(
        resolvedLibrary.endsWith("/dist/index.mjs"),
        "Runtime imports must resolve the packed artifact."
      );
      for (const compiler of ["current", "minimum"] as const) {
        console.log(
          `Checking public compiler fixtures: Effect ${version}, Query Core ${queryVersion}, ${compiler} ${compiler === "current" ? JSON.stringify(currentCompiler) : "TypeScript 5.9.3"}`
        );
        execFileSync(
          process.execPath,
          [
            ...compilerCommand(consumer, compiler),
            "--project",
            "tests/types/tsconfig.json",
            "--pretty",
            "false",
          ],
          { cwd: consumer, stdio: "inherit" }
        );
      }
      for (const compiler of ["current", "minimum"] as const) {
        const files = execFileSync(
          process.execPath,
          [
            ...compilerCommand(consumer, compiler),
            "--project",
            "tests/types/tsconfig.json",
            "--listFilesOnly",
          ],
          { cwd: consumer, encoding: "utf-8" }
        );
        ok(
          files.includes(path.join(realpathSync(library), "dist/index.d.mts")),
          "Compiler fixtures must load packed declarations."
        );
        ok(
          !files.includes(`${root}src/`),
          "Compiler fixtures must not resolve repository source."
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
  }
} finally {
  if (keep) {
    console.log(`Effect compatibility consumer directory: ${directory}`);
  } else {
    rmSync(directory, { recursive: true, force: true });
  }
}
