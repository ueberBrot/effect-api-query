import path from "node:path";

// Explicit versions prevent the wrapper's installed/latest fallback selection.
export const currentCompiler = {
  engine: "tsrs",
  package: "@effect/tsgo",
  packageVersion: "0.67.3",
  engineVersion: "0.21.0-ts7.1.0-beta",
  languageVersion: "7.1.0-beta",
} as const;

export const compilerCommand = (
  root: string,
  compiler: "current" | "minimum"
) =>
  compiler === "current"
    ? [
        path.join(root, "node_modules/@effect/tsgo/dist/effect-tsgo.cjs"),
        `tsrs@${currentCompiler.engineVersion}`,
      ]
    : [path.join(root, "node_modules/typescript-5.9/bin/tsc")];
