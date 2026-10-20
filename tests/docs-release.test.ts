import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  publishedRootVersion,
  resolveDocumentationRevision,
  verifyDocumentationVersion,
} from "../scripts/resolve-docs-release.mts";

const name = "@ueberbrot/effect-api-query";
const version = "0.1.0";
const release = "0ea1465a605c80725da9e0a0a9686c86de5b6b82";
const docs = "a".repeat(40);
const manifest = JSON.stringify({ name, version });
const registryMetadata = {
  name,
  version,
  _id: `${name}@${version}`,
  repository: {
    url: "git+https://github.com/ueberBrot/effect-api-query.git",
  },
  dist: {
    integrity: `sha512-${"A".repeat(86)}==`,
    tarball: `https://registry.npmjs.org/${name}/-/effect-api-query-${version}.tgz`,
  },
};
const metadata = JSON.stringify(registryMetadata);

const gitFixture = (
  paths: readonly string[] = [],
  options: {
    descendant?: boolean;
    releaseManifest?: string;
    docsManifest?: string;
    tree?: string;
    releaseRevision?: string;
  } = {}
) =>
  vi.fn<(args: readonly string[]) => string>((args) => {
    switch (args[0] ?? "") {
      case "rev-parse": {
        return args[2]?.startsWith("refs/tags/") === true
          ? (options.releaseRevision ?? release)
          : docs;
      }
      case "show": {
        return args[1] === `${release}:package.json`
          ? (options.releaseManifest ?? manifest)
          : (options.docsManifest ?? manifest);
      }
      case "merge-base": {
        if (options.descendant === false) {
          throw new Error("The release is not an ancestor.");
        }
        return "";
      }
      case "diff": {
        return paths.map((path) => `${path}\0`).join("");
      }
      case "ls-tree": {
        return (
          options.tree ??
          `100644 blob ${docs}\tapps/docs/src/index.mdx\0` +
            `100644 blob ${docs}\tapps/docs/src/pages/package-version.json.ts\0`
        );
      }
      case "check-ref-format": {
        return "";
      }
      default: {
        throw new Error("Unexpected Git command.");
      }
    }
  });

const resolve = (
  paths: readonly string[],
  options: Parameters<typeof gitFixture>[1] = {}
) =>
  resolveDocumentationRevision(
    version,
    "docs/corrections",
    metadata,
    gitFixture(paths, options)
  );

describe("root publication", () => {
  it("accepts the exact root version among other published packages", () => {
    expect(
      publishedRootVersion(
        manifest,
        JSON.stringify([
          { name: "another-package", version },
          { name, version },
        ])
      )
    ).toBe(version);
  });

  it.each([
    "[]",
    JSON.stringify([{ name: "another-package", version }]),
    JSON.stringify([{ name, version: "0.2.0" }]),
    JSON.stringify([
      { name, version },
      { name, version },
    ]),
    "{}",
    "null",
    "",
  ])(
    "rejects no-op, unrelated, malformed, or mismatched publication: %s",
    (packages) => {
      expect(() => publishedRootVersion(manifest, packages)).toThrow(/.+/u);
    }
  );
});

describe("manual documentation revision", () => {
  it("requires a correction ref for a legacy release and accepts its static version backport", () => {
    const tree = `100644 blob ${docs}\tapps/docs/src/index.mdx\0`;
    expect(() =>
      resolveDocumentationRevision(
        version,
        "",
        metadata,
        gitFixture([], { tree })
      )
    ).toThrow("Supply docs-ref");
    expect(
      resolveDocumentationRevision(
        version,
        "docs/version-backport",
        metadata,
        gitFixture(["apps/docs/astro.config.mts"], { tree })
      )
    ).toStrictEqual({ revision: docs, version });
    expect(() => {
      verifyDocumentationVersion(manifest, version);
    }).not.toThrow();
  });

  it("pins the conventional release tag when npm omits gitHead", () => {
    const readGit = gitFixture();
    expect(
      resolveDocumentationRevision(version, "", metadata, readGit)
    ).toStrictEqual({
      revision: release,
      version,
    });
    expect(readGit).toHaveBeenCalledWith([
      "rev-parse",
      "--verify",
      `refs/tags/${name}@${version}^{commit}`,
    ]);
  });

  it("requires a matching full gitHead when npm supplies it", () => {
    expect(
      resolveDocumentationRevision(
        version,
        "",
        JSON.stringify({ ...registryMetadata, gitHead: release }),
        gitFixture()
      )
    ).toStrictEqual({ revision: release, version });
  });

  it.each([docs, release.slice(0, 12), "main", null, `${release}\n`])(
    "rejects an inconsistent or non-immutable npm gitHead: %s",
    (gitHead) => {
      expect(() =>
        resolveDocumentationRevision(
          version,
          "",
          JSON.stringify({ ...registryMetadata, gitHead }),
          gitFixture()
        )
      ).toThrow(/.+/u);
    }
  );

  it.each([
    { ...registryMetadata, name: "another-package" },
    { ...registryMetadata, version: "0.2.0" },
    { ...registryMetadata, private: true },
    { ...registryMetadata, _id: "another-package@0.1.0" },
    {
      ...registryMetadata,
      repository: { url: "https://github.com/other/repo" },
    },
    { ...registryMetadata, dist: { ...registryMetadata.dist, integrity: "" } },
    {
      ...registryMetadata,
      dist: { ...registryMetadata.dist, tarball: "https://evil.invalid/file" },
    },
  ])("rejects inconsistent registry metadata: %j", (value) => {
    expect(() =>
      resolveDocumentationRevision(
        version,
        "",
        JSON.stringify(value),
        gitFixture()
      )
    ).toThrow(/.+/u);
  });

  it.each([
    "",
    "latest",
    "^0.1.0",
    "v0.1.0",
    "01.1.0",
    "0.1.0-01",
    "0.1.0\n",
    "$(touch /tmp/untrusted)",
  ])(
    "rejects mutable or invalid versions before consulting Git: %s",
    (input) => {
      const readGit = gitFixture();
      expect(() =>
        resolveDocumentationRevision(input, "", metadata, readGit)
      ).toThrow(/.+/u);
      expect(readGit).not.toHaveBeenCalled();
    }
  );

  it.each([
    "--help",
    "main~1",
    "main^{commit}",
    "$(touch /tmp/untrusted)",
    "main\nother",
  ])("rejects unsupported documentation refs: %s", (ref) => {
    expect(() =>
      resolveDocumentationRevision(version, ref, metadata, gitFixture())
    ).toThrow(/.+/u);
  });

  it("pins a docs branch with only permitted changes to its full commit SHA", () => {
    expect(
      resolve([
        "apps/docs/src/content/docs/index.mdx",
        "apps/docs/src/pages/package-version.json.ts",
        "apps/docs/public/package-version.js",
        "apps/docs/astro.config.mts",
        "apps/docs/tsconfig.json",
        "e2e-docs/version.test.ts",
        "playwright.docs.config.ts",
        "tests/docs-examples.test.ts",
        "tests/types/docs-quick-start.ts",
      ])
    ).toStrictEqual({ revision: docs, version });
  });

  it("accepts underscore branch names and still asks Git to validate them", () => {
    const readGit = gitFixture();
    expect(
      resolveDocumentationRevision(version, "docs/fix_badge", metadata, readGit)
    ).toStrictEqual({ revision: docs, version });
    expect(readGit).toHaveBeenCalledWith([
      "check-ref-format",
      "refs/heads/docs/fix_badge",
    ]);
  });

  it("accepts a full docs commit SHA without interpreting it as a branch", () => {
    const readGit = gitFixture();
    expect(
      resolveDocumentationRevision(version, docs, metadata, readGit)
    ).toStrictEqual({ revision: docs, version });
    expect(readGit).toHaveBeenCalledWith([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${docs}^{commit}`,
    ]);
    expect(readGit).not.toHaveBeenCalledWith([
      "check-ref-format",
      `refs/heads/${docs}`,
    ]);
  });

  it.each([
    "src/index.ts",
    "package.json",
    "pnpm-lock.yaml",
    "vite.config.ts",
    ".github/workflows/release.yml",
    "apps/docs/package.json",
    "apps/docs/src/nested/package.json",
    "apps/docs/public/package-lock.json",
    "apps/docs/src/pnpm-lock.yaml",
    "apps/docs/public/npm-shrinkwrap.json",
    "e2e-docs/nested/yarn.lock",
    "apps/docs/src/bun.lockb",
    "apps/docs/src/pnpm-workspace.yaml",
    "scripts/resolve-docs-release.mts",
    "tests/types/public-contract.ts",
  ])("rejects library, dependency, and control changes: %s", (path) => {
    expect(() => resolve([path])).toThrow("allowlist");
  });

  it("rejects unreleased main even when its package version still exists on npm", () => {
    expect(() =>
      resolveDocumentationRevision(
        version,
        "main",
        metadata,
        gitFixture(["src/rpc/create-utils.ts"])
      )
    ).toThrow("allowlist");
  });

  it("requires the released commit to be an ancestor of the docs revision", () => {
    expect(() => resolve([], { descendant: false })).toThrow("ancestor");
  });

  it.each([
    { releaseManifest: JSON.stringify({ name, version: "0.2.0" }) },
    { docsManifest: JSON.stringify({ name, version: "0.2.0" }) },
    { releaseRevision: release.slice(0, 12) },
  ])("rejects inconsistent immutable source data: %j", (options) => {
    expect(() => resolve([], options)).toThrow(/.+/u);
  });

  it.each(["120000 blob", "160000 commit"])(
    "rejects symlinks and submodules: %s",
    (mode) => {
      expect(() =>
        resolve([], { tree: `${mode} ${docs}\tapps/docs/src/escape\0` })
      ).toThrow("regular files");
    }
  );
});

describe("built documentation version", () => {
  it("explains how to supply missing static version metadata", () => {
    expect(() => {
      verifyDocumentationVersion(undefined, version);
    }).toThrow(
      "supply docs-ref with the static package version badge and JSON metadata"
    );
  });

  it("accepts a static marker for the exact released root package", () => {
    expect(() => {
      verifyDocumentationVersion(manifest, version);
    }).not.toThrow();
  });

  it.each([
    "",
    "{}",
    "null",
    JSON.stringify({ name: "another-package", version }),
    JSON.stringify({ name, version: "0.2.0" }),
  ])("rejects missing or mismatched build metadata: %s", (json) => {
    expect(() => {
      verifyDocumentationVersion(json, version);
    }).toThrow(/.+/u);
  });
});

describe("documentation workflow boundaries", () => {
  const releaseWorkflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf-8"
  );
  const deploymentWorkflow = readFileSync(
    new URL("../.github/workflows/deploy-docs.yml", import.meta.url),
    "utf-8"
  );
  const [, deployment] = releaseWorkflow.split("\n  deploy-docs:\n");
  const [, buildAndDeploy] = deploymentWorkflow.split("\n  build:\n");
  const [build, deploy] = (buildAndDeploy ?? "").split("\n  deploy:\n");

  it("requires successful validation and actual root publication before automatic deployment", () => {
    expect(deployment).toContain("needs.validation.result == 'success'");
    expect(deployment).toContain("needs.publish.result == 'success'");
    expect(deployment).toContain("needs.publish.outputs.published == 'true'");
    expect(deployment).toContain(
      "contains(fromJSON(needs.publish.outputs.published-packages).*.name, '@ueberbrot/effect-api-query')"
    );
    expect(deployment).toMatch(/needs:\n\s+- validation\n\s+- publish/u);
  });

  it("uses Changesets publish outputs and retains the publication opt-in", () => {
    expect(releaseWorkflow).toMatch(
      /published: \$\{\{ steps\.publish\.outputs\.published \}\}/u
    );
    expect(releaseWorkflow).toMatch(
      /name: Publish release artifact to npm\n\s+id: publish/u
    );
    expect(releaseWorkflow).toContain("vars.NPM_PUBLISH_ENABLED == 'true'");
  });

  it("restores automatic docs only from this run", () => {
    expect(build).toMatch(
      /if: inputs.build-artifact != ''\n\s+uses: actions\/download-artifact@[\da-f]{40}\b/u
    );
    expect(build).toContain("name: documentation-build");
    expect(build).not.toMatch(/run-id:|github-token:|repository:/u);
  });

  it("builds manual docs only at the verified SHA and verifies the static version", () => {
    expect(build).toMatch(
      /ref: \$\{\{ needs\.resolve\.outputs\.revision \}\}/u
    );
    expect(build).toMatch(
      /name: Build documentation\n\s+if: inputs.build-artifact == ''/u
    );
    expect(build).toMatch(
      /DOCS_VERSION: \$\{\{ needs\.resolve\.outputs\.version \}\}/u
    );
    expect(build).toContain('resolve-docs-release.mts" verify-build');
  });

  it("sets up repository Node before resolution and the exact resolved Node before artifact verification", () => {
    expect(deploymentWorkflow).toContain("node-version-file: .node-version");
    expect(build).toMatch(
      /node-version: \$\{\{ needs\.resolve\.outputs\.node-version \}\}/u
    );
    expect(
      deploymentWorkflow.match(/uses: actions\/setup-node@[\da-f]{40}/gu)
    ).toHaveLength(2);
    expect(
      deploymentWorkflow.indexOf("name: Set up repository Node version")
    ).toBeLessThan(
      deploymentWorkflow.indexOf("run: node scripts/resolve-docs-release.mts")
    );
    expect(build?.indexOf("name: Set up verified Node version")).toBeLessThan(
      build?.indexOf("name: Verify documentation package version") ?? 0
    );
  });

  it("keeps source execution read-only and deploys on a fresh runner", () => {
    expect(deploymentWorkflow).toContain("permissions: {}");
    expect(build).toMatch(/permissions:\n\s+contents: read/u);
    expect(build).not.toMatch(/id-token: write|pages: write/u);
    expect(deploy).toMatch(
      /permissions:\n\s+id-token: write\n\s+pages: write/u
    );
    expect(deploy).not.toMatch(
      /checkout@|run:|setup-repository|download-artifact@/u
    );
  });

  it("uses read-only checkout credentials and passes inputs as environment data", () => {
    expect(deploymentWorkflow).not.toContain("pull_request_target");
    expect(deploymentWorkflow).not.toMatch(/run:.*\$\{\{/u);
    expect(
      deploymentWorkflow.match(/persist-credentials: false/gu)
    ).toHaveLength(2);
  });

  it("retains full action commit pins", () => {
    const actions = [
      ...`${releaseWorkflow}\n${deploymentWorkflow}`.matchAll(
        /uses: (?<action>[^\s]+)/gu
      ),
    ]
      .map((match) => match[1])
      .filter((action) => action !== undefined && !action.startsWith("./"));
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toMatch(/@[\da-f]{40}$/u);
    }
  });
});
