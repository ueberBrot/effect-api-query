import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const packageName = "@ueberbrot/effect-api-query";

const Manifest = Schema.fromJsonString(
  Schema.Struct({ version: Schema.String })
);

export const packageVersion = (name: string): string =>
  Schema.decodeSync(Manifest)(
    readFileSync(
      path.join(repositoryRoot, "node_modules", name, "package.json"),
      "utf-8"
    )
  ).version;

export const positiveIntegers = (
  name: string,
  fallback: readonly number[]
): readonly number[] => {
  const value = process.env[name];
  return value === undefined
    ? fallback
    : Schema.decodeSync(
        Schema.Array(
          Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThan(0))
        ).check(Schema.isMinLength(1))
      )(value.split(","));
};

export const choices = <const Values extends readonly [string, ...string[]]>(
  name: string,
  values: Values
) =>
  Schema.decodeSync(
    Schema.Array(Schema.Literals(values)).check(Schema.isMinLength(1))
  )(process.env[name]?.split(",") ?? [...values]);

export const performanceContext = (
  buildDirectory = path.join(repositoryRoot, "dist")
) => ({
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf-8",
  }).trim(),
  workingTreeChanged:
    execFileSync("git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      encoding: "utf-8",
    }).trim().length > 0,
  effect: packageVersion("effect"),
  queryCore: packageVersion("@tanstack/query-core"),
  builtPackageSha256: createHash("sha256")
    .update(readFileSync(path.join(buildDirectory, "index.mjs")))
    .update(readFileSync(path.join(buildDirectory, "index.d.mts")))
    .digest("hex"),
});

export const prepareConsumer = (directory: string) => {
  const library = path.join(directory, "node_modules", packageName);
  mkdirSync(library, { recursive: true });
  copyFileSync(
    path.join(repositoryRoot, "package.json"),
    path.join(library, "package.json")
  );
  cpSync(path.join(repositoryRoot, "dist"), path.join(library, "dist"), {
    recursive: true,
  });
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" })
  );
  return performanceContext(path.join(library, "dist"));
};

export interface PerformanceReport<Measurement, Workload> {
  readonly context: ReturnType<typeof performanceContext> & {
    readonly rolldown?: string;
  };
  readonly workload: Workload;
  readonly measurements: readonly Measurement[];
}

export const writeReport = <Measurement, Workload>(
  report: PerformanceReport<Measurement, Workload>
): void => {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const output = process.env["PERFORMANCE_OUTPUT"];
  if (output !== undefined && output.length > 0) {
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, json);
  }
  process.stdout.write(json);
};
