import { ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compilerCommand,
  compilerExecutable,
  currentCompiler,
} from "./compiler.mts";

const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(path.join(root, ".artifacts"), { recursive: true });
const directory = mkdtempSync(path.join(root, "scripts/toolchain-"));
const source = path.join(directory, "consumer.mts");
const config = path.join(directory, "tsconfig.json");
const check = (args: string[]) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf-8",
    timeout: 60_000,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, output: result.stdout + result.stderr };
};
try {
  const version = check([...compilerCommand(root, "current"), "--version"]);
  ok(
    version.status === 0 &&
      version.output.includes("7.1.0-beta+effect-tsgo.0.67.3") &&
      version.output.includes("tsrs 0.21.0"),
    version.output
  );
  const declarationCompiler = spawnSync(compilerExecutable(), ["--version"], {
    cwd: root,
    encoding: "utf-8",
    timeout: 60_000,
  });
  ok(
    declarationCompiler.status === 0 &&
      declarationCompiler.stdout === version.output,
    declarationCompiler.error?.message ?? declarationCompiler.stderr
  );
  writeFileSync(
    config,
    JSON.stringify({
      extends: path.join(root, "tsconfig.json"),
      files: [source],
      include: [],
    })
  );
  writeFileSync(source, "export const label: string = 42;\n");
  const ordinary = check([
    ...compilerCommand(root, "current"),
    "--project",
    config,
  ]);
  ok(
    ordinary.status !== 0 && ordinary.output.includes("TS2322"),
    ordinary.output
  );
  writeFileSync(
    source,
    'import { Effect } from "effect";\nEffect.succeed(1);\n'
  );
  const effect = check([
    ...compilerCommand(root, "current"),
    "--project",
    config,
  ]);
  ok(
    effect.status !== 0 && effect.output.includes("floatingEffect"),
    effect.output
  );
  writeFileSync(source, "export async function value() { return 1; }\n");
  const lint = check([
    path.join(root, "node_modules/@effect/tsgo/dist/effect-tsgo.cjs"),
    `--tsrs-lint=${currentCompiler.engineVersion}`,
    "vp",
    "lint",
    "--no-ignore",
    source,
  ]);
  ok(lint.status !== 0 && lint.output.includes("require-await"), lint.output);
  console.log(
    "TSRS identity and TypeScript, Effect, type-aware lint rejection checks passed."
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
