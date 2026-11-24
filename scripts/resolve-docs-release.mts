import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { capture } from "./lib/exec.mts";
import {
  packageName,
  parseManifest,
  validateVersion,
} from "./verify-docs-version.mts";

const repositorySlug = "ueberBrot/effect-api-query";
const repositoryUrl = `https://github.com/${repositorySlug}`;
const repository = `git+${repositoryUrl}.git`;
const encodedPackageName = packageName.replace("/", "%2f");
const purlPackageName = packageName.replace("@", "%40");
const unscopedPackageName = packageName.slice(packageName.indexOf("/") + 1);
const approvedBranchRef = "refs/remotes/origin/main";
const releaseWorkflowRef = "refs/heads/main";
const releaseWorkflowPath = ".github/workflows/release.yml";
const signerWorkflow = `${repositorySlug}/${releaseWorkflowPath}`;
const githubOidcIssuer = "https://token.actions.githubusercontent.com";
const slsaPredicateType = "https://slsa.dev/provenance/v1";
const shaPattern = /^[\da-f]{40}$/u;
const integrityPattern = /^sha512-(?<digest>[\dA-Za-z+/]{86}==)$/u;
const maxMetadataBytes = 1_048_576;
const maxTarballBytes = 50 * 1_048_576;

export interface DocsReleaseEnv {
  readonly BUILD_ARTIFACT?: string | undefined;
  readonly DOCS_REF?: string | undefined;
  readonly DOCS_VERSION?: string | undefined;
  readonly GITHUB_EVENT_NAME?: string | undefined;
  readonly GITHUB_REF?: string | undefined;
  readonly GITHUB_SHA?: string | undefined;
  readonly PUBLISHED_PACKAGES?: string | undefined;
}

export interface DocsReleaseAdapters {
  readonly fetch?: typeof globalThis.fetch;
  readonly readManifest?: () => string;
  readonly runCommand?: (
    command: "git" | "gh",
    args: readonly string[]
  ) => string;
}

interface ProvenanceVerificationInput {
  readonly version: string;
  readonly revision: string;
  readonly expectedSha512: string;
  readonly bundleJson: string;
  readonly tarball: Buffer;
}

const validateRevision = (revision: string): string => {
  if (!shaPattern.test(revision)) {
    throw new Error("A full lowercase commit SHA is required.");
  }
  return revision;
};

const expectedTarballUrl = (version: string): string =>
  `https://registry.npmjs.org/${packageName}/-/${unscopedPackageName}-${version}.tgz`;

const expectedAttestationsUrl = (version: string): string =>
  `https://registry.npmjs.org/-/npm/v1/attestations/${encodedPackageName}@${version}`;

const assertAncestor = (
  readGit: (args: readonly string[]) => string,
  ancestor: string,
  descendant: string,
  message: string
): void => {
  try {
    readGit(["merge-base", "--is-ancestor", ancestor, descendant]);
  } catch (error) {
    throw new Error(message, { cause: error });
  }
};

const readMainFirstParents = (
  readGit: (args: readonly string[]) => string
): ReadonlySet<string> => {
  const commits = readGit(["rev-list", "--first-parent", approvedBranchRef])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (commits.length === 0) {
    throw new Error("Could not resolve the protected main branch history.");
  }
  return new Set(commits.map((commit) => validateRevision(commit)));
};

const publishedRootVersion = (
  manifest: string,
  publishedPackages: string
): string => {
  const { version } = parseManifest(manifest);
  const parsed: unknown = JSON.parse(publishedPackages);
  if (!Array.isArray(parsed)) {
    throw new TypeError("Changesets must report the published packages.");
  }
  const packages: readonly unknown[] = parsed;
  const roots = packages.filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "name" in entry &&
      entry.name === packageName
  );
  const [root] = roots;
  if (
    roots.length !== 1 ||
    typeof root !== "object" ||
    root === null ||
    !("version" in root) ||
    root.version !== version
  ) {
    throw new Error("Changesets did not publish this root package version.");
  }
  return version;
};

const parseIntegritySha512 = (integrity: string): string => {
  const match = integrityPattern.exec(integrity);
  const digest = match?.groups?.["digest"];
  if (digest === undefined) {
    throw new Error(
      "npm metadata must identify this repository's released package."
    );
  }
  return Buffer.from(digest, "base64").toString("hex");
};

const hasExpectedAttestations = (
  dist: { readonly attestations?: unknown },
  version: string
): boolean => {
  const { attestations } = dist;
  return (
    typeof attestations === "object" &&
    attestations !== null &&
    "url" in attestations &&
    attestations.url === expectedAttestationsUrl(version) &&
    "provenance" in attestations &&
    typeof attestations.provenance === "object" &&
    attestations.provenance !== null &&
    "predicateType" in attestations.provenance &&
    attestations.provenance.predicateType === slsaPredicateType
  );
};

const validateRegistryGitHead = (
  metadata: { readonly gitHead: unknown },
  revision: string
): void => {
  if (
    typeof metadata.gitHead !== "string" ||
    validateRevision(metadata.gitHead) !== revision
  ) {
    throw new Error("npm gitHead does not match the release tag.");
  }
};

const validateRegistryMetadata = (
  version: string,
  revision: string,
  json: string
): string => {
  const metadata = parseManifest(json);
  if (metadata.version !== version) {
    throw new Error("npm returned a different package version.");
  }
  if (
    !("_id" in metadata) ||
    metadata._id !== `${packageName}@${version}` ||
    !("repository" in metadata) ||
    typeof metadata.repository !== "object" ||
    metadata.repository === null ||
    !("url" in metadata.repository) ||
    metadata.repository.url !== repository ||
    !("dist" in metadata) ||
    typeof metadata.dist !== "object" ||
    metadata.dist === null ||
    !("integrity" in metadata.dist) ||
    typeof metadata.dist.integrity !== "string" ||
    !("tarball" in metadata.dist) ||
    metadata.dist.tarball !== expectedTarballUrl(version)
  ) {
    throw new Error(
      "npm metadata must identify this repository's released package."
    );
  }
  const expectedSha512 = parseIntegritySha512(metadata.dist.integrity);
  if ("gitHead" in metadata) {
    validateRegistryGitHead({ gitHead: metadata.gitHead }, revision);
  }
  if (
    !("attestations" in metadata.dist) ||
    !hasExpectedAttestations(
      { attestations: metadata.dist.attestations },
      version
    )
  ) {
    throw new Error(
      "npm metadata lacks verifiable SLSA provenance for this release."
    );
  }
  return expectedSha512;
};

const extractSlsaBundleJson = (attestationsJson: string): string => {
  const parsed: unknown = JSON.parse(attestationsJson);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("attestations" in parsed) ||
    !Array.isArray(parsed.attestations)
  ) {
    throw new Error("npm provenance response must include attestations.");
  }
  const entries: readonly unknown[] = parsed.attestations;
  const slsaEntries = entries.filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "predicateType" in entry &&
      entry.predicateType === slsaPredicateType
  );
  const [slsaEntry] = slsaEntries;
  if (
    slsaEntries.length !== 1 ||
    typeof slsaEntry !== "object" ||
    slsaEntry === null ||
    !("bundle" in slsaEntry) ||
    typeof slsaEntry.bundle !== "object" ||
    slsaEntry.bundle === null
  ) {
    throw new Error(
      "npm provenance must contain a single SLSA v1 attestation bundle."
    );
  }
  return JSON.stringify(slsaEntry.bundle);
};

const verifyVerifiedStatementSubject = (
  ghOutputJson: string,
  version: string,
  expectedSha512: string
): void => {
  const parsed: unknown = JSON.parse(ghOutputJson);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("gh attestation verify returned no verified attestations.");
  }
  const expectedPurl = `pkg:npm/${purlPackageName}@${version}`;
  const results: readonly unknown[] = parsed;
  const hasMatchingSubject = results.some((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("verificationResult" in entry) ||
      typeof entry.verificationResult !== "object" ||
      entry.verificationResult === null ||
      !("statement" in entry.verificationResult) ||
      typeof entry.verificationResult.statement !== "object" ||
      entry.verificationResult.statement === null ||
      !("subject" in entry.verificationResult.statement) ||
      !Array.isArray(entry.verificationResult.statement.subject)
    ) {
      return false;
    }
    const subjects: readonly unknown[] =
      entry.verificationResult.statement.subject;
    return subjects.some(
      (subject) =>
        typeof subject === "object" &&
        subject !== null &&
        "name" in subject &&
        subject.name === expectedPurl &&
        "digest" in subject &&
        typeof subject.digest === "object" &&
        subject.digest !== null &&
        "sha512" in subject.digest &&
        subject.digest.sha512 === expectedSha512
    );
  });
  if (!hasMatchingSubject) {
    throw new Error(
      "Verified npm provenance subject does not match the published package artifact."
    );
  }
};

const verifySlsaAttestation = (
  input: ProvenanceVerificationInput,
  runCommand: (command: "git" | "gh", args: readonly string[]) => string
): void => {
  const actualSha512 = createHash("sha512").update(input.tarball).digest("hex");
  if (actualSha512 !== input.expectedSha512) {
    throw new Error("Downloaded npm tarball does not match dist.integrity.");
  }
  const workDir = mkdtempSync(nodePath.join(tmpdir(), "docs-provenance-"));
  try {
    const tarballPath = nodePath.join(workDir, "package.tgz");
    const bundlePath = nodePath.join(workDir, "bundle.json");
    writeFileSync(tarballPath, input.tarball);
    writeFileSync(bundlePath, input.bundleJson, "utf-8");
    const output = runCommand("gh", [
      "attestation",
      "verify",
      tarballPath,
      "--bundle",
      bundlePath,
      "--digest-alg",
      "sha512",
      "--repo",
      repositorySlug,
      "--signer-workflow",
      signerWorkflow,
      "--source-ref",
      releaseWorkflowRef,
      "--source-digest",
      input.revision,
      "--cert-oidc-issuer",
      githubOidcIssuer,
      "--predicate-type",
      slsaPredicateType,
      "--deny-self-hosted-runners",
      "--format",
      "json",
    ]);
    verifyVerifiedStatementSubject(output, input.version, input.expectedSha512);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
};

const permittedDocumentationPath = (path: string): boolean => {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (
    /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.(?:yaml|yml)|pnpm-workspace\.(?:yaml|yml)|yarn\.lock|bun\.lockb?)$/u.test(
      basename
    )
  ) {
    return false;
  }
  return (
    /^apps\/docs\/(?:src|public)\/.+$/u.test(path) ||
    path === "apps/docs/astro.config.mts" ||
    path === "apps/docs/tsconfig.json" ||
    path === "tests/docs-examples.test.ts" ||
    /^tests\/types\/docs-[^/]+\.(?:ts|tsx)$/u.test(path)
  );
};

const readBoundedResponse = async (
  response: Response,
  maxBytes: number,
  oversizedMessage: string
): Promise<Buffer> => {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    await response.body?.cancel();
    throw new Error(oversizedMessage);
  }
  if (response.body === null) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new Error(oversizedMessage);
    }
    return bytes;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new Error(oversizedMessage);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
};

const fetchRegistryBytes = async (
  fetchImpl: typeof globalThis.fetch,
  url: string,
  maxBytes: number,
  unavailableMessage: string,
  oversizedMessage: string
): Promise<Buffer> => {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(unavailableMessage);
  }
  return readBoundedResponse(response, maxBytes, oversizedMessage);
};

const resolveDocsRefRevision = (
  readGit: (args: readonly string[]) => string,
  release: string,
  docsRef: string,
  mainFirstParents: ReadonlySet<string>
): string => {
  let ref = docsRef;
  if (!shaPattern.test(ref)) {
    if (ref.length > 255 || !/^[\da-zA-Z_][\da-zA-Z_./-]*$/u.test(ref)) {
      throw new Error("docs-ref must be a branch name or a full commit SHA.");
    }
    readGit(["check-ref-format", `refs/heads/${ref}`]);
    ref = `refs/remotes/origin/${ref}`;
  }
  const revision = validateRevision(
    readGit([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ]).trim()
  );
  assertAncestor(
    readGit,
    release,
    revision,
    "The released commit must be an ancestor of docs-ref."
  );
  if (!mainFirstParents.has(revision)) {
    throw new Error(
      "docs-ref must be on the protected main branch's first-parent history."
    );
  }
  const changes = readGit([
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    release,
    revision,
    "--",
  ])
    .split("\0")
    .filter((path) => path !== "");
  if (changes.some((path) => !permittedDocumentationPath(path))) {
    throw new Error(
      "docs-ref changes files outside the documentation allowlist."
    );
  }
  return revision;
};

const resolveManualDocsRelease = async (
  version: string,
  docsRef: string,
  fetchImpl: typeof globalThis.fetch,
  runCommand: (command: "git" | "gh", args: readonly string[]) => string
) => {
  validateVersion(version);
  const readGit = (args: readonly string[]) => runCommand("git", args);
  const metadataBytes = await fetchRegistryBytes(
    fetchImpl,
    `https://registry.npmjs.org/${encodedPackageName}/${version}`,
    maxMetadataBytes,
    "The exact package version is unavailable from npm.",
    "npm returned oversized package metadata."
  );
  const attestationsBytes = await fetchRegistryBytes(
    fetchImpl,
    expectedAttestationsUrl(version),
    maxMetadataBytes,
    "npm provenance attestations are unavailable for this package version.",
    "npm returned oversized provenance attestations."
  );
  const tarball = await fetchRegistryBytes(
    fetchImpl,
    expectedTarballUrl(version),
    maxTarballBytes,
    "The exact package tarball is unavailable from npm.",
    "npm returned an oversized package tarball."
  );
  const release = validateRevision(
    readGit([
      "rev-parse",
      "--verify",
      `refs/tags/${packageName}@${version}^{commit}`,
    ]).trim()
  );
  const expectedSha512 = validateRegistryMetadata(
    version,
    release,
    metadataBytes.toString("utf-8")
  );
  const bundleJson = extractSlsaBundleJson(attestationsBytes.toString("utf-8"));
  verifySlsaAttestation(
    { version, revision: release, expectedSha512, bundleJson, tarball },
    runCommand
  );
  const mainFirstParents = readMainFirstParents(readGit);
  if (!mainFirstParents.has(release)) {
    throw new Error(
      "The release commit must be on the protected main branch's first-parent history."
    );
  }
  if (
    parseManifest(readGit(["show", `${release}:package.json`])).version !==
    version
  ) {
    throw new Error("The release tag's root package does not match npm.");
  }
  const revision =
    docsRef === ""
      ? release
      : resolveDocsRefRevision(readGit, release, docsRef, mainFirstParents);
  const tree = readGit([
    "ls-tree",
    "-r",
    "-z",
    revision,
    "--",
    "apps/docs",
    "tests/docs-examples.test.ts",
    "tests/types",
  ]).split("\0");
  if (
    tree.some((entry) => entry !== "" && !/^100(?:644|755) blob /u.test(entry))
  ) {
    throw new Error("Documentation trees must contain regular files only.");
  }
  if (
    docsRef === "" &&
    !tree.some((entry) =>
      entry.endsWith("\tapps/docs/src/pages/package-version.json.ts")
    )
  ) {
    throw new Error(
      "The released documentation lacks static version metadata. Supply docs-ref with a docs-only correction that emits package-version.json and displays the built package version."
    );
  }
  if (
    parseManifest(readGit(["show", `${revision}:package.json`])).version !==
    version
  ) {
    throw new Error(
      "The documentation revision's root package does not match npm."
    );
  }
  return { revision, version };
};

export const resolveDocsRelease = async (
  env: DocsReleaseEnv,
  adapters: DocsReleaseAdapters = {}
) => {
  const artifact = env.BUILD_ARTIFACT ?? "";
  if (artifact === "") {
    return resolveManualDocsRelease(
      env.DOCS_VERSION ?? "",
      env.DOCS_REF ?? "",
      adapters.fetch ?? globalThis.fetch,
      adapters.runCommand ?? capture
    );
  }
  if (
    artifact !== "documentation-build" ||
    env.GITHUB_EVENT_NAME !== "push" ||
    env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error(
      "Automatic documentation must use the release run's CI artifact."
    );
  }
  const readManifest =
    adapters.readManifest ?? (() => readFileSync("package.json", "utf-8"));
  return {
    revision: validateRevision(env.GITHUB_SHA ?? ""),
    version: publishedRootVersion(readManifest(), env.PUBLISHED_PACKAGES ?? ""),
  };
};

if (import.meta.main) {
  const release = await resolveDocsRelease(process.env);
  const output = process.env["GITHUB_OUTPUT"];
  if (output === undefined || output === "") {
    throw new Error("GITHUB_OUTPUT is required.");
  }
  appendFileSync(
    output,
    `revision=${release.revision}\nversion=${release.version}\n`
  );
}
