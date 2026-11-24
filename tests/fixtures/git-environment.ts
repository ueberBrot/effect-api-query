import { execFileSync } from "node:child_process";

const repositoryVariables = new Set(
  execFileSync("git", ["rev-parse", "--local-env-vars"], {
    encoding: "utf-8",
  })
    .trim()
    .split(/\s+/u)
);

export const fixtureGitEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !repositoryVariables.has(name)
    )
  );
