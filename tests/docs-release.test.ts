import { spawnSync } from "node:child_process";
import { sign } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { Predicate } from "effect";
import { describe, expect, it, vi } from "vitest";
import { isScalar, visit } from "yaml";

import {
  publishedRootVersion,
  resolveDocumentationRevision,
} from "../scripts/resolve-docs-release.mts";
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
const mainTip = "b".repeat(40);
const integrityBase64 = `${"A".repeat(86)}==`;
const expectedSha512 = Buffer.from(integrityBase64, "base64").toString("hex");
const manifest = JSON.stringify({ name, version });
const attestationUrl = `https://registry.npmjs.org/-/npm/v1/attestations/${encodedName}@${version}`;
const slsaPredicateType = "https://slsa.dev/provenance/v1";
const dssePayloadType = "application/vnd.in-toto+json";
const defaultWorkflowSan =
  "URI:https://github.com/ueberBrot/effect-api-query/.github/workflows/release.yml@refs/heads/main";

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

const createSigner = (san: string) => {
  const cwd = mkdtempSync(nodePath.join(tmpdir(), "docs-signer-"));
  try {
    const keyPath = nodePath.join(cwd, "key.pem");
    const certPath = nodePath.join(cwd, "cert.der");
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-outform",
        "DER",
        "-days",
        "1",
        "-subj",
        "/CN=sigstore-test",
        "-addext",
        `subjectAltName=${san}`,
      ],
      { encoding: "utf-8" }
    );
    if (result.status !== 0) {
      throw new Error(`openssl failed: ${result.stderr}`);
    }
    return {
      privateKeyPem: readFileSync(keyPath, "utf-8"),
      certBase64: readFileSync(certPath).toString("base64"),
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

const releaseSigner = createSigner(defaultWorkflowSan);
const foreignSigner = createSigner(
  "URI:https://github.com/ueberBrot/effect-api-query/.github/workflows/ci.yml@refs/heads/feature"
);

const createAttestations = (
  options: {
    signer?: { readonly privateKeyPem: string; readonly certBase64: string };
    gitCommit?: string;
    sha512?: string;
    subjectName?: string;
    workflowRef?: string;
    workflowPath?: string;
    workflowRepo?: string;
    tamperSignature?: boolean;
    tlogEntries?: readonly unknown[];
    useCertChain?: boolean;
  } = {}
) => {
  const signer = options.signer ?? releaseSigner;
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: slsaPredicateType,
    subject: [
      {
        name: options.subjectName ?? `pkg:npm/${purlName}@${version}`,
        digest: {
          sha512: options.sha512 ?? expectedSha512,
        },
      },
    ],
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            ref: options.workflowRef ?? "refs/heads/main",
            repository:
              options.workflowRepo ??
              "https://github.com/ueberBrot/effect-api-query",
            path: options.workflowPath ?? ".github/workflows/release.yml",
          },
        },
        resolvedDependencies: [
          {
            uri: `git+${options.workflowRepo ?? "https://github.com/ueberBrot/effect-api-query"}@${options.workflowRef ?? "refs/heads/main"}`,
            digest: {
              gitCommit: options.gitCommit ?? release,
            },
          },
        ],
      },
    },
  };
  const payloadBytes = Buffer.from(JSON.stringify(statement), "utf-8");
  const pae = Buffer.concat([
    Buffer.from(
      `DSSEv1 ${dssePayloadType.length} ${dssePayloadType} ${payloadBytes.length} `,
      "utf-8"
    ),
    payloadBytes,
  ]);
  const signature = sign("sha256", pae, signer.privateKeyPem);
  if (options.tamperSignature === true) {
    signature[0] = ((signature[0] ?? 0) + 1) % 256;
  }
  const verificationMaterial =
    options.useCertChain === true
      ? {
          x509CertificateChain: {
            certificates: [{ rawBytes: signer.certBase64 }],
          },
          tlogEntries: options.tlogEntries ?? [{ logIndex: "1" }],
        }
      : {
          certificate: { rawBytes: signer.certBase64 },
          tlogEntries: options.tlogEntries ?? [{ logIndex: "1" }],
        };
  return JSON.stringify({
    attestations: [
      {
        predicateType:
          "https://github.com/npm/attestation/tree/main/specs/publish/v0.1",
        bundle: {},
      },
      {
        predicateType: slsaPredicateType,
        bundle: {
          mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
          verificationMaterial,
          dsseEnvelope: {
            payloadType: dssePayloadType,
            payload: payloadBytes.toString("base64"),
            signatures: [{ sig: signature.toString("base64") }],
          },
        },
      },
    ],
  });
};

const validAttestations = createAttestations();

interface GitFixtureOptions {
  descendant?: boolean;
  releaseReachableFromMain?: boolean;
  docsReachableFromMain?: boolean;
  releaseManifest?: string;
  docsManifest?: string;
  tree?: string;
  releaseRevision?: string;
}

const checkMergeBase = (
  args: readonly string[],
  options: GitFixtureOptions
): string => {
  const [ancestor, descendant] = args.slice(2);
  if (
    ancestor === release &&
    descendant === mainTip &&
    options.releaseReachableFromMain === false
  ) {
    throw new Error("The release is not reachable from main.");
  }
  if (
    ancestor === release &&
    descendant === docs &&
    options.descendant === false
  ) {
    throw new Error("The release is not an ancestor.");
  }
  if (
    ancestor === docs &&
    descendant === mainTip &&
    options.docsReachableFromMain === false
  ) {
    throw new Error("docs-ref is not reachable from main.");
  }
  return "";
};

const gitFixture = (
  paths: readonly string[] = [],
  options: GitFixtureOptions = {}
) =>
  vi.fn<(args: readonly string[]) => string>((args) => {
    switch (args[0] ?? "") {
      case "rev-parse": {
        const target = args.at(-1) ?? "";
        if (target.startsWith("refs/tags/")) {
          return options.releaseRevision ?? release;
        }
        if (target === "refs/remotes/origin/main^{commit}") {
          return mainTip;
        }
        return docs;
      }
      case "show": {
        return args[1] === `${release}:package.json`
          ? (options.releaseManifest ?? manifest)
          : (options.docsManifest ?? manifest);
      }
      case "merge-base": {
        return checkMergeBase(args, options);
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
  options: Parameters<typeof gitFixture>[1] = {},
  attestations: string = validAttestations
) =>
  resolveDocumentationRevision(
    version,
    "docs/corrections",
    metadata,
    attestations,
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
        gitFixture([], { tree })
      )
    ).toThrow("Supply docs-ref");
    expect(
      resolveDocumentationRevision(
        version,
        "docs/version-backport",
        metadata,
        validAttestations,
        gitFixture(["apps/docs/astro.config.mts"], { tree })
      )
    ).toStrictEqual({ revision: docs, version });
    expect(runVersionVerifier(manifest).status).toBe(0);
  });

  it("binds the release tag via npm SLSA provenance when npm omits gitHead", () => {
    const readGit = gitFixture();
    expect(
      resolveDocumentationRevision(
        version,
        "",
        metadata,
        validAttestations,
        readGit
      )
    ).toStrictEqual({
      revision: release,
      version,
    });
    expect(readGit).toHaveBeenCalledWith([
      "rev-parse",
      "--verify",
      `refs/tags/${name}@${version}^{commit}`,
    ]);
    expect(readGit).toHaveBeenCalledWith([
      "merge-base",
      "--is-ancestor",
      release,
      mainTip,
    ]);
  });

  it("accepts a matching x509CertificateChain provenance bundle", () => {
    expect(
      resolveDocumentationRevision(
        version,
        "",
        metadata,
        createAttestations({ useCertChain: true }),
        gitFixture()
      )
    ).toStrictEqual({ revision: release, version });
  });

  it("requires a matching full gitHead when npm supplies it alongside provenance", () => {
    expect(
      resolveDocumentationRevision(
        version,
        "",
        JSON.stringify({ ...registryMetadata, gitHead: release }),
        validAttestations,
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
          validAttestations,
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
        gitFixture()
      )
    ).toThrow(/.+/u);
  });

  it.each([
    ["missing attestations array", JSON.stringify({})],
    ["missing SLSA provenance entry", JSON.stringify({ attestations: [] })],
    ["tampered DSSE signature", createAttestations({ tamperSignature: true })],
    [
      "untrusted certificate SAN",
      createAttestations({ signer: foreignSigner }),
    ],
    ["empty transparency log entries", createAttestations({ tlogEntries: [] })],
    [
      "mismatched artifact sha512",
      createAttestations({ sha512: "f".repeat(128) }),
    ],
    [
      "mismatched package purl",
      createAttestations({ subjectName: "pkg:npm/other@0.1.0" }),
    ],
    [
      "wrong workflow ref",
      createAttestations({ workflowRef: "refs/heads/feature" }),
    ],
    [
      "wrong workflow path",
      createAttestations({ workflowPath: ".github/workflows/ci.yml" }),
    ],
    [
      "wrong workflow repository",
      createAttestations({ workflowRepo: "https://github.com/other/repo" }),
    ],
    [
      "moved release tag (gitCommit mismatch)",
      createAttestations({ gitCommit: docs }),
    ],
  ])("rejects invalid release provenance (%s)", (_label, attestations) => {
    expect(() =>
      resolveDocumentationRevision(
        version,
        "",
        metadata,
        attestations,
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
        resolveDocumentationRevision(
          input,
          "",
          metadata,
          validAttestations,
          readGit
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
        gitFixture()
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
        docsReachableFromMain: false,
      })
    ).toThrow("protected main branch");
  });

  it("rejects an unreviewed docs-ref commit SHA even when changed paths match the allowlist", () => {
    expect(() =>
      resolveDocumentationRevision(
        version,
        docs,
        metadata,
        validAttestations,
        gitFixture(["apps/docs/src/content/docs/index.mdx"], {
          docsReachableFromMain: false,
        })
      )
    ).toThrow("protected main branch");
  });

  it("rejects a release commit that is not reachable from the protected main branch", () => {
    expect(() =>
      resolveDocumentationRevision(
        version,
        "",
        metadata,
        validAttestations,
        gitFixture([], { releaseReachableFromMain: false })
      )
    ).toThrow("protected main branch");
  });

  it("accepts underscore branch names and still asks Git to validate them", () => {
    const readGit = gitFixture();
    expect(
      resolveDocumentationRevision(
        version,
        "docs/fix_badge",
        metadata,
        validAttestations,
        readGit
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
        readGit
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
