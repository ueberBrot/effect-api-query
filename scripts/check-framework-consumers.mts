import { ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = nodePath.join(root, "tests/framework-consumers");
const frameworks = ["vue", "solid", "svelte", "angular"];
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const keep = args.includes("--keep");
const selected = args.filter((arg) => arg !== "--keep");
ok(
  selected.every((framework) => frameworks.includes(framework)),
  `Expected framework names (${frameworks.join(", ")}) or --keep.`
);
const artifacts = nodePath.join(root, ".artifacts");
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(nodePath.join(artifacts, "framework-consumers-"));
const project = nodePath.join(
  directory,
  selected.length > 0 ? "tsconfig.selected.json" : "tsconfig.json"
);
const run = (command: string, commandArgs: string[], cwd = directory) =>
  execFileSync(command, commandArgs, { cwd, stdio: "inherit" });

try {
  for (const entry of readdirSync(fixtures)) {
    if (entry !== "node_modules") {
      cpSync(nodePath.join(fixtures, entry), nodePath.join(directory, entry), {
        recursive: true,
      });
    }
  }
  if (selected.length > 0) {
    writeFileSync(
      project,
      JSON.stringify(
        {
          extends: "./tsconfig.json",
          include: [
            "./contracts.ts",
            ...selected.map((framework) => `./${framework}.ts`),
          ],
        },
        null,
        2
      )
    );
  }

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

  run("vp", [
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--prefer-offline",
    "--silent",
  ]);
  run("vp", [
    "add",
    "--save-dev",
    "--workspace-root",
    "--ignore-scripts",
    "--prefer-offline",
    "--silent",
    nodePath.join(directory, tarball),
  ]);
  const library = nodePath.join(
    directory,
    "node_modules/@ueberbrot/effect-api-query"
  );
  const resolved = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "process.stdout.write(import.meta.resolve('@ueberbrot/effect-api-query'))",
    ],
    { cwd: directory, encoding: "utf-8" }
  );
  const entry = realpathSync(fileURLToPath(resolved));
  ok(
    entry.startsWith(`${realpathSync(library)}${nodePath.sep}`) &&
      !existsSync(nodePath.join(library, "src")),
    "Consumers must resolve the packed library without repository sources."
  );

  for (const compiler of ["typescript", "typescript-5.9"]) {
    console.log(
      `Checking ${selected.join(", ") || "all frameworks"}: ${compiler}`
    );
    run(process.execPath, [
      nodePath.join(directory, "node_modules", compiler, "bin/tsc"),
      "--project",
      project,
      "--pretty",
      "false",
    ]);
  }
} finally {
  if (keep) {
    console.log(`Framework consumer directory: ${directory}`);
  } else {
    rmSync(directory, { recursive: true, force: true });
  }
}
