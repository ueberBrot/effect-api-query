import { readFileSync } from "node:fs";

import ts from "typescript-5.9";
import { describe, expect, it } from "vitest";

import { decodeUtf8 } from "./fixtures/decode-utf8.ts";

const syntaxNodes = (
  source: string,
  kind: ts.ScriptKind
): readonly string[] => {
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.EndOfFileToken) {
      return;
    }
    if (
      !ts.isParenthesizedExpression(node) &&
      !ts.isParenthesizedTypeNode(node)
    ) {
      let text = "";
      if (
        ts.isIdentifier(node) ||
        ts.isPrivateIdentifier(node) ||
        ts.isLiteralExpression(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)
      ) {
        ({ text } = node);
      } else if (ts.isVariableDeclarationList(node)) {
        text = String(node.getFirstToken()?.kind);
      }
      result.push(`${node.kind}:${text}`);
    }
    ts.forEachChild(node, visit);
  };
  const parsed = ts.createSourceFile(
    "excerpt.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
  ts.forEachChild(parsed, visit);
  return result;
};

describe("documentation excerpts", () => {
  it.each([
    [
      "README.md",
      [
        "tests/types/docs-readme-rpc-contract",
        "tests/types/docs-readme-rpc",
        "tests/types/docs-readme-http-contract",
        "tests/types/docs-readme-http",
      ],
    ],
    [
      "getting-started/quick-start",
      [
        "tests/types/docs-rpc-quick-start-contract",
        "tests/types/docs-rpc-quick-start",
      ],
    ],
    [
      "getting-started/http-quick-start",
      [
        "tests/types/docs-http-quick-start-contract",
        "tests/types/docs-http-quick-start",
      ],
    ],
    [
      "guides/react-query",
      [
        "tests/types/docs-readme-http-contract",
        "tests/types/docs-react-client",
        "tests/types/docs-react-setup.tsx",
        "tests/types/docs-react-entry",
      ],
    ],
    ["guides/suspense-and-recovery", ["tests/types/docs-suspense.tsx"]],
    [
      "guides/trace-streams",
      [
        "tests/types/docs-stream-tracing-contract",
        "tests/types/docs-stream-tracing",
      ],
    ],
    ["guides/query-defaults", ["tests/types/docs-policies"]],
    ["reference/type-inference", ["tests/types/docs-policies"]],
    ["guides/queries", ["tests/types/docs-functionality"]],
    ["guides/mutations", ["tests/types/docs-functionality"]],
    ["guides/pagination", ["tests/types/docs-functionality"]],
    ["guides/streaming", ["tests/types/docs-functionality"]],
    ["guides/http-metadata", ["tests/types/docs-functionality"]],
    ["guides/http-queries-and-mutations", ["tests/types/docs-functionality"]],
    ["guides/retry-queries", ["tests/types/docs-retry"]],
    ["guides/refresh-from-events", ["tests/types/docs-user-events"]],
    [
      "guides/websocket-clients",
      ["tests/fixtures/socket-client", "tests/fixtures/docs-websocket-use"],
    ],
    ["guides/stream-snapshots", ["tests/types/docs-stream-snapshot"]],
    [
      "guides/hydrate-query-views",
      ["tests/types/docs-hydration-views", "tests/types/hydration-contract"],
    ],
    [
      "guides/hydrate-unary-data",
      [
        "tests/types/docs-hydration-dto",
        "tests/types/docs-hydration-rich",
        "tests/types/docs-hydration-async",
      ],
    ],
  ] as const)("%s matches its compiler fixtures", (page, fixtures) => {
    const markdown = decodeUtf8(
      readFileSync(
        new URL(
          page === "README.md"
            ? "../README.md"
            : `../apps/docs/src/content/docs/${page}.md`,
          import.meta.url
        )
      )
    );
    const samples = [
      ...markdown.matchAll(
        /^```(?<language>ts|tsx)\n(?<source>[\s\S]*?)^```/gmu
      ),
    ];
    expect(
      samples.length,
      `${page} must contain a TypeScript excerpt`
    ).toBeGreaterThan(0);
    const sources: (readonly string[])[] = [];
    for (const fixture of fixtures) {
      const fixturePath = /\.tsx?$/u.test(fixture) ? fixture : `${fixture}.ts`;
      const source = decodeUtf8(
        readFileSync(new URL(`../${fixturePath}`, import.meta.url))
      );
      sources.push(
        syntaxNodes(
          source
            .replaceAll("#effect-api-query", "@ueberbrot/effect-api-query")
            .replaceAll("./docs-readme-rpc-contract.ts", "./rpc-contract.ts")
            .replaceAll("./docs-readme-http-contract.ts", "./http-contract.ts")
            .replaceAll(
              "./docs-rpc-quick-start-contract.ts",
              "./rpc-contract.ts"
            )
            .replaceAll(
              "./docs-http-quick-start-contract.ts",
              "./http-contract.ts"
            )
            .replaceAll("./docs-react-client.ts", "./client.ts")
            .replaceAll(
              "./docs-stream-tracing-contract.ts",
              "./feed-contract.ts"
            )
            .replaceAll("./docs-react-setup.tsx", "./users-app.tsx")
            .replaceAll("../fixtures/user-events.ts", "./user-events.ts"),
          fixturePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        )
      );
    }
    for (const [index, sample] of samples.entries()) {
      const lines = syntaxNodes(
        sample.groups?.["source"] ?? "",
        sample.groups?.["language"] === "tsx"
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS
      );
      expect(
        lines.some((line) => line.trim().length > 0),
        `${page} excerpt ${index + 1} is empty`
      ).toBe(true);
      expect(
        sources.some((source) =>
          source.some((_, start) =>
            source
              .slice(start, start + lines.length)
              .every((token, offset) => token === lines[offset])
          )
        ),
        `${page} excerpt ${index + 1} differs from its allowed fixtures`
      ).toBe(true);
    }
  });
});
