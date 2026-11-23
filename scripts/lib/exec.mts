import { execFileSync } from "node:child_process";

export const capture = (
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string }
): string => execFileSync(command, args, { ...options, encoding: "utf-8" });

export const run = (
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string }
): void => {
  execFileSync(command, args, { ...options, stdio: "inherit" });
};

export const git = (...args: readonly string[]): string => capture("git", args);
