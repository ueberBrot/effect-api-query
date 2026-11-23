import path from "node:path";

import { describe, expect, it } from "vitest";

import noCommentsPlugin from "../scripts/oxlint-no-comments.mts";
import type {
  NoCommentsOptions,
  RuleReport,
  SourceLocation,
} from "../scripts/oxlint-no-comments.mts";

interface FakeComment {
  readonly type: "Line" | "Block";
  readonly value: string;
  readonly loc: SourceLocation;
}

const makeComment = (
  type: "Line" | "Block",
  value: string,
  line = 1
): FakeComment => ({
  type,
  value,
  loc: {
    start: { line, column: 0 },
    end: { line, column: value.length + 2 },
  },
});

const runRule = (
  relativeFile: string,
  comments: readonly FakeComment[],
  options: NoCommentsOptions = {}
): readonly RuleReport[] => {
  const reports: RuleReport[] = [];
  const cwd = "/repo";
  const visitor = noCommentsPlugin.rules["no-comments"].create({
    cwd,
    filename: path.join(cwd, ...relativeFile.split("/")),
    options: [options],
    sourceCode: {
      getAllComments: () => comments,
    },
    report: (entry) => {
      reports.push(entry);
    },
  });
  visitor.Program({ type: "Program" });
  return reports;
};

describe("repo/no-comments", () => {
  it("reports prose comments in unratcheted files", () => {
    const reports = runRule("src/core/example.ts", [
      makeComment("Line", " explains something obvious"),
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toContain("Code comments are banned");
  });

  it("keeps public API JSDoc in src/ and rejects JSDoc outside src/", () => {
    const inSrc = runRule("src/core/example.ts", [
      makeComment("Block", "* Public API docs "),
    ]);
    expect(inSrc).toStrictEqual([]);

    const outsideSrc = runRule("examples/demo.ts", [
      makeComment("Block", "* Internal example JSDoc "),
    ]);
    expect(outsideSrc).toHaveLength(1);
  });

  it("allows compiler, linter, and tooling directives", () => {
    const effectDiag = ["@effect", "diagnostics-next-line rule:off"].join("-");
    const reports = runRule("tests/example.test.ts", [
      makeComment("Line", '/ <reference types="vite/client" />'),
      makeComment("Line", " @ts-expect-error intentional"),
      makeComment("Line", ` ${effectDiag}`),
      makeComment("Line", " oxlint-disable-next-line eslint/no-await-in-loop"),
      makeComment("Block", " oxlint-enable typescript/no-unsafe-assignment "),
      makeComment("Block", " @__PURE__ "),
      makeComment("Line", " @vitest-environment jsdom"),
      makeComment("Line", " fallow-ignore-file unused-export"),
    ]);
    expect(reports).toStrictEqual([]);
  });

  it("enforces the ratchet upper bound", () => {
    const ratchet = { "src/core/configure.ts": 2 };

    const exact = runRule(
      "src/core/configure.ts",
      [
        makeComment("Line", " SAFETY: first", 1),
        makeComment("Line", " SAFETY: second", 2),
      ],
      { ratchet }
    );
    expect(exact).toStrictEqual([]);

    const exceeded = runRule(
      "src/core/configure.ts",
      [
        makeComment("Line", " SAFETY: first", 1),
        makeComment("Line", " SAFETY: second", 2),
        makeComment("Line", " extra comment", 3),
      ],
      { ratchet }
    );
    expect(exceeded).toHaveLength(1);
    expect(exceeded[0]?.message).toContain("exceeds ratchet limit (2)");
  });

  it("requires tightening or removing the ratchet when comments drop", () => {
    const ratchet = { "src/core/configure.ts": 2 };

    const tightened = runRule(
      "src/core/configure.ts",
      [makeComment("Line", " SAFETY: first", 1)],
      { ratchet }
    );
    expect(tightened).toHaveLength(1);
    expect(tightened[0]?.message).toContain("Tighten ratchet");

    const cleared = runRule("src/core/configure.ts", [], { ratchet });
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.message).toContain("can be removed");
  });
});
