import path from "node:path";

export interface SourceLocation {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

interface SourceComment {
  readonly type: "Line" | "Block";
  readonly value: string;
  readonly loc: SourceLocation;
}

export interface NoCommentsOptions {
  readonly publicApiPrefixes?: readonly string[];
  readonly ratchet?: Readonly<Record<string, number>>;
}

interface ProgramNode {
  readonly type: "Program";
}

export interface RuleReport {
  readonly loc?: SourceLocation;
  readonly node?: { readonly type: "Program" };
  readonly message: string;
}

interface RuleContext {
  readonly cwd: string;
  readonly filename: string;
  readonly options: readonly (NoCommentsOptions | undefined)[];
  readonly sourceCode: {
    readonly getAllComments: () => readonly SourceComment[];
  };
  readonly report: (entry: RuleReport) => void;
}

const DIRECTIVE_PATTERNS = [
  /^\/\s*<reference\b/u,
  /^@ts-(?:expect-error|ignore|nocheck)\b/u,
  /^@effect-diagnostics(?:-next-line)?\b/u,
  /^oxlint-(?:disable|enable)(?:-next-line|-line)?\b/u,
  /^eslint-(?:disable|enable)(?:-next-line|-line)?\b/u,
  /^@__PURE__$/u,
  /^@vitest-environment\b/u,
  /^fallow-ignore(?:-file|-next-line)?\b/u,
  /^(?:oxfmt|prettier)-ignore\b/u,
];

const isDirectiveComment = (comment: SourceComment): boolean => {
  const trimmed = comment.value.trim();
  return DIRECTIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
};

const isJsDocComment = (comment: SourceComment): boolean =>
  comment.type === "Block" && comment.value.startsWith("*");

const normalizeRelativePath = (cwd: string, filename: string): string =>
  path.relative(cwd, filename).split(path.sep).join("/");

const isPublicApiFile = (
  relativePath: string,
  prefixes: readonly string[]
): boolean => prefixes.some((prefix) => relativePath.startsWith(prefix));

const noCommentsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban non-directive code comments with a per-file ratchet, keeping public API JSDoc/TSDoc.",
    },
    schema: [
      {
        type: "object",
        properties: {
          publicApiPrefixes: {
            type: "array",
            items: { type: "string" },
          },
          ratchet: {
            type: "object",
            additionalProperties: {
              type: "integer",
              minimum: 0,
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context: RuleContext) {
    const options = context.options[0] ?? {};
    const publicApiPrefixes = options.publicApiPrefixes ?? ["src/"];
    const ratchet = options.ratchet ?? {};
    const relativePath = normalizeRelativePath(context.cwd, context.filename);
    const allowJsDoc = isPublicApiFile(relativePath, publicApiPrefixes);
    const allowedCount = Object.hasOwn(ratchet, relativePath)
      ? (ratchet[relativePath] ?? 0)
      : 0;

    return {
      Program(node: ProgramNode) {
        const comments = context.sourceCode.getAllComments();
        const disallowed = comments.filter((comment) => {
          if (allowJsDoc && isJsDocComment(comment)) {
            return false;
          }
          if (isDirectiveComment(comment)) {
            return false;
          }
          return true;
        });

        if (disallowed.length > allowedCount) {
          for (const comment of disallowed.slice(allowedCount)) {
            context.report({
              loc: comment.loc,
              message:
                allowedCount === 0
                  ? "Code comments are banned. Delete tautologies/stale comments, file an issue for excuses, move decisions to docs/adr/, or keep public API JSDoc in src/. Run /delete-comment."
                  : `Comment count (${String(disallowed.length)}) exceeds ratchet limit (${String(allowedCount)}) for ${relativePath}. Remove the extra comment or run /delete-comment.`,
            });
          }
          return;
        }

        if (allowedCount > 0 && disallowed.length < allowedCount) {
          context.report({
            node,
            message:
              disallowed.length === 0
                ? `Ratchet for ${relativePath} can be removed from vite.config.ts (0 disallowed comments remaining).`
                : `Tighten ratchet for ${relativePath} in vite.config.ts from ${String(allowedCount)} to ${String(disallowed.length)}.`,
          });
        }
      },
    };
  },
};

export default {
  meta: {
    name: "repo",
  },
  rules: {
    "no-comments": noCommentsRule,
  },
};
