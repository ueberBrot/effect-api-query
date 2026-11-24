import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { Predicate } from "effect";
import { describe, expect, it, vi } from "vitest";
import { isScalar, visit } from "yaml";

import { capture } from "../scripts/lib/exec.mts";
import {
  extractSlsaBundleJson,
  publishedRootVersion,
  resolveDocumentationRevision,
  verifySlsaAttestationWithGh,
} from "../scripts/resolve-docs-release.mts";
import type { ProvenanceVerifier } from "../scripts/resolve-docs-release.mts";
import {
  readWorkflow,
  workflowSteps,
  workflowValue,
} from "./fixtures/workflow";

const name = "@ueberbrot/effect-api-query";
const encodedName = "@ueberbrot%2feffect-api-query";
const purlName = "%40ueberbrot/effect-api-query";
const version = "0.1.0";
const release = "0ea1465a605c80725da9e0a0a9686c86de5b6b82";
const docs = "a".repeat(40);
const tarball = Buffer.from("release-tarball-fixture", "utf-8");
const expectedSha512 = createHash("sha512").update(tarball).digest("hex");
const integrityBase64 = Buffer.from(expectedSha512, "hex").toString("base64");
const manifest = JSON.stringify({ name, version });
const attestationUrl = `https://registry.npmjs.org/-/npm/v1/attestations/${encodedName}@${version}`;
const slsaPredicateType = "https://slsa.dev/provenance/v1";

const registryMetadata = {
  name,
  version,
  _id: `${name}@${version}`,
  repository: {
    url: "git+https://github.com/ueberBrot/effect-api-query.git",
  },
  dist: {
    integrity: `sha512-${integrityBase64}`,
    tarball: `https://registry.npmjs.org/${name}/-/effect-api-query-${version}.tgz`,
    attestations: {
      url: attestationUrl,
      provenance: {
        predicateType: slsaPredicateType,
      },
    },
  },
};
const metadata = JSON.stringify(registryMetadata);
const validBundle = {
  mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
  verificationMaterial: {},
  dsseEnvelope: {},
};
const validAttestations = JSON.stringify({
  attestations: [
    {
      predicateType:
        "https://github.com/npm/attestation/tree/main/specs/publish/v0.1",
      bundle: {},
    },
    {
      predicateType: slsaPredicateType,
      bundle: validBundle,
    },
  ],
});

const acceptProvenance: ProvenanceVerifier = () => {};

interface GitFixtureOptions {
  descendant?: boolean;
  firstParents?: readonly string[];
  releaseManifest?: string;
  docsManifest?: string;
  tree?: string;
  releaseRevision?: string;
}

const gitFixture = (
  paths: readonly string[] = [],
  options: GitFixtureOptions = {}
) =>
  vi.fn<(args: readonly string[]) => string>((args) => {
    switch (args[0] ?? "") {
      case "rev-parse": {
        const target = args.at(-1) ?? "";
        return target.startsWith("refs/tags/")
          ? (options.releaseRevision ?? release)
          : docs;
      }
      case "rev-list": {
        return `${(options.firstParents ?? [docs, release]).join("\n")}\n`;
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
  options: GitFixtureOptions = {},
  verifyProvenance: ProvenanceVerifier = acceptProvenance
) =>
  resolveDocumentationRevision(
    version,
    "docs/corrections",
    metadata,
    validAttestations,
    tarball,
    gitFixture(paths, options),
    verifyProvenance
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

const runVersionVerifier = (json?: string) => {
  const cwd = mkdtempSync(nodePath.join(tmpdir(), "docs-version-"));
  try {
    const verifier = nodePath.join(cwd, "verify-docs-version.mts");
    if (json !== undefined) {
      const dist = nodePath.join(cwd, "apps/docs/dist");
      mkdirSync(dist, { recursive: true });
      writeFileSync(nodePath.join(dist, "package-version.json"), json);
    }
    copyFileSync(
      new URL("../scripts/verify-docs-version.mts", import.meta.url),
      verifier
    );
    return spawnSync(process.execPath, [verifier], {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, DOCS_VERSION: version },
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

describe("manual documentation revision", () => {
  it("requires a correction ref for a legacy release and accepts its static version backport", () => {
    const tree = `100644 blob ${docs}\tapps/docs/src/index.mdx\0`;
    expect(() =>
      resolveDocumentationRevision(
        version,
        "",
        metadata,
        validAttestations,
        tarball,
        gitFixture([], { tree }),
        acceptProvenance
      )
    ).toThrow("Supply docs-ref");
    expect(
      resolveDocumentationRevision(
        version,
        "docs/version-backport",
        metadata,
        validAttestations,
        tarball,
        gitFixture(["apps/docs/astro.config.mts"], { tree }),
        acceptProvenance
      )
    ).toStrictEqual({ revision: docs, version });
    expect(runVersionVerifier(manifest).status).toBe(0);
  });

  it("binds the release tag via npm SLSA provenance when npm omits gitHead", () => {
    const readGit = gitFixture();
    const verifier = vi.fn<ProvenanceVerifier>();
    expect(
      resolveDocumentationRevision(
        version,
        "",
        metadata,
        validAttestations,
        tarball,
        readGit,
        verifier
      )
    ).toStrictEqual({
      revision: release,
      version,
    });
    expect(verifier).toHaveBeenCalledWith({
      version,
      revision: release,
      expectedSha512,
      bundleJson: JSON.stringify(validBundle),
      tarball,
    });
    expect(readGit).toHaveBeenCalledWith([
      "rev-parse",
      "--verify",
      `refs/tags/${name}@${version}^{commit}`,
    ]);
    expect(readGit).toHaveBeenCalledWith([
      "rev-list",
      "--first-parent",
      "refs/remotes/origin/main",
    ]);
  });

  it("requires a matching full gitHead when npm supplies it alongside provenance", () => {
    expect(
      resolveDocumentationRevision(
        version,
        "",
        JSON.stringify({ ...registryMetadata, gitHead: release }),
        validAttestations,
        tarball,
        gitFixture(),
        acceptProvenance
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
          validAttestations,
          tarball,
          gitFixture(),
          acceptProvenance
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
    {
      ...registryMetadata,
      dist: {
        integrity: registryMetadata.dist.integrity,
        tarball: registryMetadata.dist.tarball,
      },
    },
    {
      ...registryMetadata,
      dist: {
        ...registryMetadata.dist,
        attestations: {
          ...registryMetadata.dist.attestations,
          url: "https://evil.invalid/attestations",
        },
      },
    },
    {
      ...registryMetadata,
      dist: {
        ...registryMetadata.dist,
        attestations: {
          ...registryMetadata.dist.attestations,
          provenance: { predicateType: "https://slsa.dev/provenance/v0.2" },
        },
      },
    },
  ])("rejects inconsistent or unattested registry metadata: %j", (value) => {
    expect(() =>
      resolveDocumentationRevision(
        version,
        "",
        JSON.stringify(value),
        validAttestations,
        tarball,
        gitFixture(),
        acceptProvenance
      )
    ).toThrow(/.+/u);
  });

  it.each([
    ["missing attestations array", JSON.stringify({})],
    ["missing SLSA provenance entry", JSON.stringify({ attestations: [] })],
    [
      "duplicate SLSA provenance entries",
      JSON.stringify({
        attestations: [
          { predicateType: slsaPredicateType, bundle: validBundle },
          { predicateType: slsaPredicateType, bundle: validBundle },
        ],
      }),
    ],
    [
      "missing bundle object",
      JSON.stringify({
        attestations: [{ predicateType: slsaPredicateType }],
      }),
    ],
  ])("rejects malformed provenance envelopes (%s)", (_label, attestations) => {
    expect(() => extractSlsaBundleJson(attestations)).toThrow(/.+/u);
  });

  it("rejects when cryptographic provenance verification fails", () => {
    expect(() =>
      resolve([], {}, () => {
        throw new Error("Sigstore verification failed.");
      })
    ).toThrow("Sigstore verification failed.");
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
        resolveDocumentationRevision(
          input,
          "",
          metadata,
          validAttestations,
          tarball,
          readGit,
          acceptProvenance
        )
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
      resolveDocumentationRevision(
        version,
        ref,
        metadata,
        validAttestations,
        tarball,
        gitFixture(),
        acceptProvenance
      )
    ).toThrow(/.+/u);
  });

  it("pins a reviewed docs branch with only permitted changes to its full commit SHA", () => {
    expect(
      resolve([
        "apps/docs/src/content/docs/index.mdx",
        "apps/docs/src/pages/package-version.json.ts",
        "apps/docs/public/package-version.js",
        "apps/docs/astro.config.mts",
        "apps/docs/tsconfig.json",
        "tests/docs-examples.test.ts",
        "tests/types/docs-quick-start.ts",
      ])
    ).toStrictEqual({ revision: docs, version });
  });

  it("rejects an unreviewed docs-ref branch even when changed paths match the allowlist", () => {
    expect(() =>
      resolve(["apps/docs/astro.config.mts", "tests/docs-examples.test.ts"], {
        firstParents: [release],
      })
    ).toThrow("first-parent history");
  });

  it("rejects an unreviewed docs-ref commit SHA even when changed paths match the allowlist", () => {
    expect(() =>
      resolveDocumentationRevision(
        version,
        docs,
        metadata,
        validAttestations,
        tarball,
        gitFixture(["apps/docs/src/content/docs/index.mdx"], {
          firstParents: [release],
        }),
        acceptProvenance
      )
    ).toThrow("first-parent history");
  });

  it("rejects a release commit outside the protected main first-parent history", () => {
    expect(() =>
      resolveDocumentationRevision(
        version,
        "",
        metadata,
        validAttestations,
        tarball,
        gitFixture([], { firstParents: [docs] }),
        acceptProvenance
      )
    ).toThrow("first-parent history");
  });

  it("accepts underscore branch names and still asks Git to validate them", () => {
    const readGit = gitFixture();
    expect(
      resolveDocumentationRevision(
        version,
        "docs/fix_badge",
        metadata,
        validAttestations,
        tarball,
        readGit,
        acceptProvenance
      )
    ).toStrictEqual({ revision: docs, version });
    expect(readGit).toHaveBeenCalledWith([
      "check-ref-format",
      "refs/heads/docs/fix_badge",
    ]);
  });

  it("accepts a reviewed full docs commit SHA without interpreting it as a branch", () => {
    const readGit = gitFixture();
    expect(
      resolveDocumentationRevision(
        version,
        docs,
        metadata,
        validAttestations,
        tarball,
        readGit,
        acceptProvenance
      )
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
    "apps/docs/src/bun.lockb",
    "apps/docs/src/pnpm-workspace.yaml",
    "scripts/resolve-docs-release.mts",
    "tests/types/public-contract.ts",
  ])("rejects library, dependency, and control changes: %s", (path) => {
    expect(() => resolve([path])).toThrow("allowlist");
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

const verifiedOutput = (
  subjectName = `pkg:npm/${purlName}@${version}`,
  sha512 = expectedSha512
) =>
  JSON.stringify([
    {
      verificationResult: {
        statement: {
          subject: [{ name: subjectName, digest: { sha512 } }],
        },
      },
    },
  ]);

describe("gh attestation provenance verifier", () => {
  it("passes strict Sigstore policy flags to gh attestation verify and validates the subject", () => {
    const runCommand = vi.fn<
      (command: string, args: readonly string[]) => string
    >(() => verifiedOutput());
    verifySlsaAttestationWithGh(
      {
        version,
        revision: release,
        expectedSha512,
        bundleJson: JSON.stringify(validBundle),
        tarball,
      },
      runCommand
    );
    expect(runCommand).toHaveBeenCalledOnce();
    const [call] = runCommand.mock.calls;
    expect(call?.[0]).toBe("gh");
    expect(call?.[1]).toStrictEqual(
      expect.arrayContaining([
        "attestation",
        "verify",
        "--digest-alg",
        "sha512",
        "--repo",
        "ueberBrot/effect-api-query",
        "--signer-workflow",
        "ueberBrot/effect-api-query/.github/workflows/release.yml",
        "--source-ref",
        "refs/heads/main",
        "--source-digest",
        release,
        "--cert-oidc-issuer",
        "https://token.actions.githubusercontent.com",
        "--predicate-type",
        slsaPredicateType,
        "--deny-self-hosted-runners",
        "--format",
        "json",
      ])
    );
  });

  it("rejects a tarball whose sha512 disagrees with dist.integrity before calling gh", () => {
    const runCommand = vi.fn<
      (command: string, args: readonly string[]) => string
    >(() => verifiedOutput());
    expect(() => {
      verifySlsaAttestationWithGh(
        {
          version,
          revision: release,
          expectedSha512,
          bundleJson: JSON.stringify(validBundle),
          tarball: Buffer.from("tampered-tarball", "utf-8"),
        },
        runCommand
      );
    }).toThrow("dist.integrity");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["empty result", "[]"],
    ["mismatched package purl", verifiedOutput("pkg:npm/other@0.1.0")],
    ["mismatched digest", verifiedOutput(undefined, "f".repeat(128))],
  ])(
    "rejects gh attestation output with invalid subject (%s)",
    (_label, output) => {
      expect(() => {
        verifySlsaAttestationWithGh(
          {
            version,
            revision: release,
            expectedSha512,
            bundleJson: JSON.stringify(validBundle),
            tarball,
          },
          () => output
        );
      }).toThrow(/.+/u);
    }
  );
});

describe("first-parent merge graph enforcement", () => {
  it("rejects intermediate PR commits and unmerged branches while accepting reviewed merges on main", () => {
    const cwd = mkdtempSync(nodePath.join(tmpdir(), "docs-git-graph-"));
    const runGit = (args: readonly string[]) => capture("git", args, { cwd });
    try {
      runGit(["init", "--initial-branch=main"]);
      runGit(["config", "user.name", "Test"]);
      runGit(["config", "user.email", "test@example.com"]);
      mkdirSync(nodePath.join(cwd, "apps/docs/src/pages"), { recursive: true });
      writeFileSync(nodePath.join(cwd, "package.json"), manifest);
      writeFileSync(
        nodePath.join(cwd, "apps/docs/src/pages/package-version.json.ts"),
        "export const GET = () => new Response();\n"
      );
      writeFileSync(
        nodePath.join(cwd, "apps/docs/astro.config.mts"),
        "export default {};\n"
      );
      runGit(["add", "."]);
      runGit(["commit", "-m", "release"]);
      const releaseSha = runGit(["rev-parse", "HEAD"]).trim();
      runGit(["tag", `${name}@${version}`, releaseSha]);

      runGit(["checkout", "-b", "pr/docs-fix"]);
      writeFileSync(
        nodePath.join(cwd, "apps/docs/astro.config.mts"),
        "export default { unreviewed: true };\n"
      );
      runGit(["commit", "-am", "unreviewed intermediate commit"]);
      const intermediateSha = runGit(["rev-parse", "HEAD"]).trim();
      writeFileSync(
        nodePath.join(cwd, "apps/docs/astro.config.mts"),
        "export default {};\n"
      );
      writeFileSync(
        nodePath.join(cwd, "apps/docs/src/index.mdx"),
        "# Reviewed docs\n"
      );
      runGit(["add", "."]);
      runGit(["commit", "-m", "clean reviewed state"]);

      runGit(["checkout", "main"]);
      runGit(["merge", "--no-ff", "pr/docs-fix", "-m", "Merge PR"]);
      const mergeSha = runGit(["rev-parse", "HEAD"]).trim();
      runGit(["update-ref", "refs/remotes/origin/main", mergeSha]);

      runGit(["checkout", "-b", "docs/unreviewed", releaseSha]);
      writeFileSync(
        nodePath.join(cwd, "apps/docs/src/index.mdx"),
        "# Unreviewed branch\n"
      );
      runGit(["add", "."]);
      runGit(["commit", "-m", "unreviewed branch commit"]);
      const unreviewedSha = runGit(["rev-parse", "HEAD"]).trim();
      runGit([
        "update-ref",
        "refs/remotes/origin/docs/unreviewed",
        unreviewedSha,
      ]);
      runGit(["checkout", "main"]);

      expect(() =>
        resolveDocumentationRevision(
          version,
          intermediateSha,
          metadata,
          validAttestations,
          tarball,
          runGit,
          acceptProvenance
        )
      ).toThrow("first-parent history");

      expect(() =>
        resolveDocumentationRevision(
          version,
          "docs/unreviewed",
          metadata,
          validAttestations,
          tarball,
          runGit,
          acceptProvenance
        )
      ).toThrow("first-parent history");

      expect(
        resolveDocumentationRevision(
          version,
          mergeSha,
          metadata,
          validAttestations,
          tarball,
          runGit,
          acceptProvenance
        )
      ).toStrictEqual({ revision: mergeSha, version });

      expect(
        resolveDocumentationRevision(
          version,
          "main",
          metadata,
          validAttestations,
          tarball,
          runGit,
          acceptProvenance
        )
      ).toStrictEqual({ revision: mergeSha, version });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("built documentation version", () => {
  it("runs the uploaded verifier with only the restored docs and script", () => {
    expect(runVersionVerifier(manifest).status).toBe(0);
  });

  it("explains how to supply missing static version metadata", () => {
    const result = runVersionVerifier();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "supply docs-ref with the static package version badge and JSON metadata"
    );
  });

  it.each([
    ["", "SyntaxError"],
    ["{}", "public root package name and version must match"],
    ["null", "public root package name and version must match"],
    [
      JSON.stringify({ name: "another-package", version }),
      "public root package name and version must match",
    ],
    [
      JSON.stringify({ name, version: "0.2.0" }),
      "documentation build is for a different package version",
    ],
  ])("rejects invalid build metadata: %s", (json, message) => {
    const result = runVersionVerifier(json);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});

const expression = (body: string) => `\${{ ${body} }}`;

describe("documentation workflow boundaries", () => {
  const releaseWorkflow = readWorkflow("release");
  const docsWorkflow = readWorkflow("deploy-docs");
  const resolveSteps = workflowSteps(docsWorkflow, "resolve");
  const build = workflowSteps(docsWorkflow, "build");
  const deploy = workflowSteps(docsWorkflow, "deploy");
  const jobValue = (
    workflow: typeof docsWorkflow,
    job: string,
    ...fields: string[]
  ) => workflowValue(workflow, ["jobs", job, ...fields]);
  const uses = (step: (typeof build)[number], action: string) => {
    const reference = step.get("uses");
    return Predicate.isString(reference) && reference.startsWith(`${action}@`);
  };
  const download = (artifactName: string) =>
    build.find(
      (step) =>
        uses(step, "actions/download-artifact") &&
        step.getIn(["with", "name"]) === artifactName
    );
  const hasSameRunSource = (step: (typeof build)[number] | undefined) =>
    step !== undefined &&
    ["run-id", "github-token", "repository"].every(
      (field) => step.getIn(["with", field]) === undefined
    );

  it("requires successful validation and actual root publication before automatic deployment", () => {
    const condition = jobValue(releaseWorkflow, "deploy-docs", "if");
    expect(
      new Set(
        String(condition)
          .split(/\s*&&\s*/u)
          .map((term) => term.trim())
      )
    ).toStrictEqual(
      new Set([
        "github.ref == 'refs/heads/main'",
        "needs.validation.result == 'success'",
        "needs.publish.result == 'success'",
        "needs.publish.outputs.published == 'true'",
        "contains(fromJSON(needs.publish.outputs.published-packages).*.name, '@ueberbrot/effect-api-query')",
      ])
    );
    expect(jobValue(releaseWorkflow, "deploy-docs", "needs")).toStrictEqual(
      expect.arrayContaining(["validation", "publish"])
    );
  });

  it("publishes only after validation and packing, with explicit opt-in", () => {
    const publish = workflowSteps(releaseWorkflow, "publish").find(
      (step) => step.get("id") === "publish"
    );
    expect({
      prerequisite: jobValue(releaseWorkflow, "quality-and-pack", "needs"),
      published: jobValue(releaseWorkflow, "publish", "outputs", "published"),
      publishesWithChangesets:
        publish !== undefined && uses(publish, "changesets/action/publish"),
    }).toMatchObject({
      prerequisite: "select-mode",
      published: expression("steps.publish.outputs.published"),
      publishesWithChangesets: true,
    });
    expect(jobValue(releaseWorkflow, "publish", "needs")).toStrictEqual(
      expect.arrayContaining(["select-mode", "quality-and-pack", "validation"])
    );
    expect(
      new Set(
        String(jobValue(releaseWorkflow, "publish", "if"))
          .split(/\s*&&\s*/u)
          .map((term) => term.trim())
      )
    ).toStrictEqual(
      new Set([
        "needs.select-mode.outputs.mode == 'publish'",
        "github.event_name == 'push'",
        "vars.NPM_PUBLISH_ENABLED == 'true'",
      ])
    );
  });

  it("restores documentation and its trusted verifier from this run", () => {
    const artifact = download("documentation-build");
    const verifier = download("documentation-verifier");
    const upload = resolveSteps.find((step) =>
      uses(step, "actions/upload-artifact")
    );
    expect({
      condition: artifact?.get("if"),
      sameRunBuild: hasSameRunSource(artifact),
      sameRunVerifier: hasSameRunSource(verifier),
      verifierArtifact: upload?.getIn(["with", "name"]),
      verifierPath: upload?.getIn(["with", "path"]),
    }).toStrictEqual({
      condition: "inputs.build-artifact != ''",
      sameRunBuild: true,
      sameRunVerifier: true,
      verifierArtifact: "documentation-verifier",
      verifierPath: "scripts/verify-docs-version.mts",
    });
  });

  it("builds manual docs only at the verified SHA and verifies the static version", () => {
    const checkout = build.find((step) => uses(step, "actions/checkout"));
    const buildDocs = build.find(
      (step) => step.get("run") === "vp run docs-build"
    );
    const verifiedNode = build.findIndex(
      (step) =>
        uses(step, "actions/setup-node") &&
        step.getIn(["with", "node-version"]) ===
          expression("needs.resolve.outputs.node-version")
    );
    const verifyVersion = build.findIndex(
      (step) =>
        step.get("run") ===
          'node "$RUNNER_TEMP/documentation-verifier/verify-docs-version.mts"' &&
        step.getIn(["env", "DOCS_VERSION"]) ===
          expression("needs.resolve.outputs.version")
    );
    expect({
      revision: checkout?.getIn(["with", "ref"]),
      buildWhen: buildDocs?.get("if"),
      verifiedAfterNodeSetup:
        verifiedNode !== -1 && verifyVersion > verifiedNode,
    }).toStrictEqual({
      revision: expression("needs.resolve.outputs.revision"),
      buildWhen: "inputs.build-artifact == ''",
      verifiedAfterNodeSetup: true,
    });
  });

  it("sets up repository Node before resolving the release", () => {
    const node = resolveSteps.findIndex(
      (step) =>
        uses(step, "actions/setup-node") &&
        step.getIn(["with", "node-version-file"]) === ".node-version"
    );
    const resolveVersion = resolveSteps.findIndex(
      (step) => step.get("run") === "node scripts/resolve-docs-release.mts"
    );
    expect(node !== -1 && resolveVersion > node).toBe(true);
  });

  it("keeps source execution read-only and deploys on a fresh runner", () => {
    expect({
      topLevel: workflowValue(docsWorkflow, ["permissions"]),
      build: jobValue(docsWorkflow, "build", "permissions"),
      deploy: jobValue(docsWorkflow, "deploy", "permissions"),
      deployNeeds: jobValue(docsWorkflow, "deploy", "needs"),
    }).toStrictEqual({
      topLevel: {},
      build: { contents: "read" },
      deploy: { "id-token": "write", pages: "write" },
      deployNeeds: "build",
    });
    expect(
      deploy.map((step) => [
        uses(step, "actions/deploy-pages"),
        step.get("run"),
      ])
    ).toStrictEqual([[true, undefined]]);
  });

  it("uses read-only checkout credentials and passes inputs as environment data", () => {
    expect(
      docsWorkflow.getIn(["on", "pull_request_target"], true)
    ).toBeUndefined();
    for (const steps of [resolveSteps, build]) {
      const checkout = steps.find((step) => uses(step, "actions/checkout"));
      expect(checkout?.getIn(["with", "persist-credentials"])).toBe(false);
    }
    const scripts = [...resolveSteps, ...build, ...deploy].map((step) =>
      step.get("run")
    );
    expect(
      scripts.some((run) => Predicate.isString(run) && /\$\{\{/u.test(run))
    ).toBe(false);
  });

  it("retains full action commit pins", () => {
    const references: string[] = [];
    for (const workflow of [releaseWorkflow, docsWorkflow]) {
      visit(workflow, {
        Pair: (_key, { key, value }) => {
          if (
            isScalar(key) &&
            key.value === "uses" &&
            isScalar(value) &&
            Predicate.isString(value.value) &&
            !value.value.startsWith("./")
          ) {
            references.push(value.value);
          }
        },
      });
    }
    expect(references.length).toBeGreaterThan(0);
    expect(
      references.every((reference) => /@[\da-f]{40}$/u.test(reference))
    ).toBe(true);
  });
});
