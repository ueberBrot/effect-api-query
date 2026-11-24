import { X509Certificate, verify } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

import { capture } from "./lib/exec.mts";
import {
  packageName,
  parseManifest,
  validateVersion,
} from "./verify-docs-version.mts";

const repository = "git+https://github.com/ueberBrot/effect-api-query.git";
const repositoryUrl = "https://github.com/ueberBrot/effect-api-query";
const encodedPackageName = "@ueberbrot%2feffect-api-query";
const purlPackageName = "%40ueberbrot/effect-api-query";
const approvedBranchRef = "refs/remotes/origin/main";
const releaseWorkflowRef = "refs/heads/main";
const releaseWorkflowPath = ".github/workflows/release.yml";
const expectedSignerSan = `URI:${repositoryUrl}/${releaseWorkflowPath}@${releaseWorkflowRef}`;
const slsaPredicateType = "https://slsa.dev/provenance/v1";
const githubActionsBuildType =
  "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const inTotoStatementType = "https://in-toto.io/Statement/v1";
const dssePayloadType = "application/vnd.in-toto+json";
const shaPattern = /^[\da-f]{40}$/u;
const integrityPattern = /^sha512-(?<digest>[\dA-Za-z+/]{86}==)$/u;

interface RegistryDist {
  readonly integrity: string;
  readonly tarball: string;
  readonly attestations?: unknown;
}

interface RawSlsaBundle {
  readonly verificationMaterial: {
    readonly certificate?: unknown;
    readonly x509CertificateChain?: unknown;
    readonly tlogEntries?: unknown;
  };
  readonly dsseEnvelope: {
    readonly payloadType?: unknown;
    readonly payload?: unknown;
    readonly signatures?: unknown;
  };
}

interface SlsaBundle {
  readonly certDer: Buffer;
  readonly payload: string;
  readonly sig: string;
}

interface RawBuildDefinition {
  readonly buildType?: unknown;
  readonly externalParameters?: unknown;
  readonly resolvedDependencies?: unknown;
}

const validateRevision = (revision: string): string => {
  if (!shaPattern.test(revision)) {
    throw new Error("A full lowercase commit SHA is required.");
  }
  return revision;
};

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

export const publishedRootVersion = (
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

const validateDistAttestations = (
  dist: RegistryDist,
  version: string
): void => {
  const { attestations } = dist;
  if (
    typeof attestations !== "object" ||
    attestations === null ||
    !("url" in attestations) ||
    attestations.url !== expectedAttestationsUrl(version) ||
    !("provenance" in attestations) ||
    typeof attestations.provenance !== "object" ||
    attestations.provenance === null ||
    !("predicateType" in attestations.provenance) ||
    attestations.provenance.predicateType !== slsaPredicateType
  ) {
    throw new Error(
      "npm metadata lacks verifiable SLSA provenance for this release."
    );
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
    metadata.dist.tarball !==
      `https://registry.npmjs.org/${packageName}/-/effect-api-query-${version}.tgz`
  ) {
    throw new Error(
      "npm metadata must identify this repository's released package."
    );
  }
  const dist: RegistryDist = {
    integrity: metadata.dist.integrity,
    tarball: metadata.dist.tarball,
    attestations:
      "attestations" in metadata.dist ? metadata.dist.attestations : undefined,
  };
  const expectedSha512 = parseIntegritySha512(dist.integrity);
  if (
    "gitHead" in metadata &&
    (typeof metadata.gitHead !== "string" ||
      validateRevision(metadata.gitHead) !== revision)
  ) {
    throw new Error("npm gitHead does not match the release tag.");
  }
  validateDistAttestations(dist, version);
  return expectedSha512;
};

const readLeafCertificateDer = (
  verificationMaterial: RawSlsaBundle["verificationMaterial"]
): Buffer | undefined => {
  const { certificate, x509CertificateChain } = verificationMaterial;
  if (
    typeof certificate === "object" &&
    certificate !== null &&
    "rawBytes" in certificate &&
    typeof certificate.rawBytes === "string" &&
    certificate.rawBytes.length > 0
  ) {
    return Buffer.from(certificate.rawBytes, "base64");
  }
  if (
    typeof x509CertificateChain === "object" &&
    x509CertificateChain !== null &&
    "certificates" in x509CertificateChain &&
    Array.isArray(x509CertificateChain.certificates)
  ) {
    const certificates: readonly unknown[] = x509CertificateChain.certificates;
    const [first] = certificates;
    if (
      typeof first === "object" &&
      first !== null &&
      "rawBytes" in first &&
      typeof first.rawBytes === "string" &&
      first.rawBytes.length > 0
    ) {
      return Buffer.from(first.rawBytes, "base64");
    }
  }
  return undefined;
};

const parseDsseEnvelope = (dsseEnvelope: RawSlsaBundle["dsseEnvelope"]) => {
  const { payloadType, payload, signatures } = dsseEnvelope;
  if (
    payloadType !== dssePayloadType ||
    typeof payload !== "string" ||
    payload.length === 0 ||
    !Array.isArray(signatures) ||
    signatures.length !== 1
  ) {
    throw new Error("npm provenance DSSE envelope is malformed.");
  }
  const signatureList: readonly unknown[] = signatures;
  const [firstSignature] = signatureList;
  if (
    typeof firstSignature !== "object" ||
    firstSignature === null ||
    !("sig" in firstSignature) ||
    typeof firstSignature.sig !== "string" ||
    firstSignature.sig.length === 0
  ) {
    throw new Error("npm provenance DSSE signature is missing.");
  }
  return { payload, sig: firstSignature.sig };
};

const selectRawSlsaBundle = (json: string): RawSlsaBundle => {
  const parsed: unknown = JSON.parse(json);
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
    slsaEntry.bundle === null ||
    !("verificationMaterial" in slsaEntry.bundle) ||
    typeof slsaEntry.bundle.verificationMaterial !== "object" ||
    slsaEntry.bundle.verificationMaterial === null ||
    !("dsseEnvelope" in slsaEntry.bundle) ||
    typeof slsaEntry.bundle.dsseEnvelope !== "object" ||
    slsaEntry.bundle.dsseEnvelope === null
  ) {
    throw new Error(
      "npm provenance must contain a single SLSA v1 attestation bundle."
    );
  }
  return {
    verificationMaterial: slsaEntry.bundle.verificationMaterial,
    dsseEnvelope: slsaEntry.bundle.dsseEnvelope,
  };
};

const parseSlsaBundle = (json: string): SlsaBundle => {
  const { verificationMaterial, dsseEnvelope } = selectRawSlsaBundle(json);
  if (
    !Array.isArray(verificationMaterial.tlogEntries) ||
    verificationMaterial.tlogEntries.length === 0
  ) {
    throw new Error(
      "npm provenance bundle must include transparency log entries."
    );
  }
  const certDer = readLeafCertificateDer(verificationMaterial);
  if (certDer === undefined || certDer.length === 0) {
    throw new Error(
      "npm provenance bundle must include a signing certificate."
    );
  }
  const { payload, sig } = parseDsseEnvelope(dsseEnvelope);
  return { certDer, payload, sig };
};

const verifyDssePayload = (bundle: SlsaBundle): Buffer => {
  const cert = new X509Certificate(bundle.certDer);
  if (cert.subjectAltName !== expectedSignerSan) {
    throw new Error(
      "npm provenance certificate does not match this repository's release workflow."
    );
  }
  const payloadBytes = Buffer.from(bundle.payload, "base64");
  const pae = Buffer.concat([
    Buffer.from(
      `DSSEv1 ${dssePayloadType.length} ${dssePayloadType} ${payloadBytes.length} `,
      "utf-8"
    ),
    payloadBytes,
  ]);
  const algorithm =
    cert.publicKey.asymmetricKeyType === "ed25519" ? null : "sha256";
  if (
    !verify(algorithm, pae, cert.publicKey, Buffer.from(bundle.sig, "base64"))
  ) {
    throw new Error("npm provenance DSSE signature verification failed.");
  }
  return payloadBytes;
};

const verifyResolvedSourceCommit = (
  resolvedDependencies: readonly unknown[],
  revision: string
): void => {
  const expectedSourceUri = `git+${repositoryUrl}@${releaseWorkflowRef}`;
  const matchingSources = resolvedDependencies.filter(
    (dep) =>
      typeof dep === "object" &&
      dep !== null &&
      "uri" in dep &&
      dep.uri === expectedSourceUri
  );
  const [source] = matchingSources;
  if (
    matchingSources.length !== 1 ||
    typeof source !== "object" ||
    source === null ||
    !("digest" in source) ||
    typeof source.digest !== "object" ||
    source.digest === null ||
    !("gitCommit" in source.digest) ||
    typeof source.digest.gitCommit !== "string" ||
    validateRevision(source.digest.gitCommit) !== revision
  ) {
    throw new Error(
      "npm provenance source commit does not match the release tag."
    );
  }
};

const verifyBuildDefinition = (
  buildDefinition: RawBuildDefinition,
  revision: string
): void => {
  const { buildType, externalParameters, resolvedDependencies } =
    buildDefinition;
  if (
    buildType !== githubActionsBuildType ||
    typeof externalParameters !== "object" ||
    externalParameters === null ||
    !("workflow" in externalParameters) ||
    typeof externalParameters.workflow !== "object" ||
    externalParameters.workflow === null ||
    !("repository" in externalParameters.workflow) ||
    externalParameters.workflow.repository !== repositoryUrl ||
    !("ref" in externalParameters.workflow) ||
    externalParameters.workflow.ref !== releaseWorkflowRef ||
    !("path" in externalParameters.workflow) ||
    externalParameters.workflow.path !== releaseWorkflowPath ||
    !Array.isArray(resolvedDependencies)
  ) {
    throw new Error(
      "npm provenance does not match this repository's release workflow."
    );
  }
  const deps: readonly unknown[] = resolvedDependencies;
  verifyResolvedSourceCommit(deps, revision);
};

const verifyReleaseProvenance = (
  version: string,
  revision: string,
  expectedSha512: string,
  json: string
): void => {
  const payloadBytes = verifyDssePayload(parseSlsaBundle(json));
  const statement: unknown = JSON.parse(payloadBytes.toString("utf-8"));
  if (
    typeof statement !== "object" ||
    statement === null ||
    !("_type" in statement) ||
    statement._type !== inTotoStatementType ||
    !("predicateType" in statement) ||
    statement.predicateType !== slsaPredicateType ||
    !("subject" in statement) ||
    !Array.isArray(statement.subject) ||
    !("predicate" in statement) ||
    typeof statement.predicate !== "object" ||
    statement.predicate === null ||
    !("buildDefinition" in statement.predicate) ||
    typeof statement.predicate.buildDefinition !== "object" ||
    statement.predicate.buildDefinition === null
  ) {
    throw new Error("npm provenance statement is malformed.");
  }
  const expectedPurl = `pkg:npm/${purlPackageName}@${version}`;
  const subjects: readonly unknown[] = statement.subject;
  const hasMatchingSubject = subjects.some(
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
  if (!hasMatchingSubject) {
    throw new Error(
      "npm provenance subject does not match the published package artifact."
    );
  }
  verifyBuildDefinition(statement.predicate.buildDefinition, revision);
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

export const resolveDocumentationRevision = (
  version: string,
  docsRef: string,
  metadata: string,
  attestations: string,
  readGit: (args: readonly string[]) => string
) => {
  validateVersion(version);
  const release = validateRevision(
    readGit([
      "rev-parse",
      "--verify",
      `refs/tags/${packageName}@${version}^{commit}`,
    ]).trim()
  );
  const expectedSha512 = validateRegistryMetadata(version, release, metadata);
  verifyReleaseProvenance(version, release, expectedSha512, attestations);
  const approvedTip = validateRevision(
    readGit(["rev-parse", "--verify", `${approvedBranchRef}^{commit}`]).trim()
  );
  assertAncestor(
    readGit,
    release,
    approvedTip,
    "The release commit must be reachable from the protected main branch."
  );
  if (
    parseManifest(readGit(["show", `${release}:package.json`])).version !==
    version
  ) {
    throw new Error("The release tag's root package does not match npm.");
  }
  let revision = release;
  if (docsRef !== "") {
    let ref = docsRef;
    if (!shaPattern.test(ref)) {
      if (ref.length > 255 || !/^[\da-zA-Z_][\da-zA-Z_./-]*$/u.test(ref)) {
        throw new Error("docs-ref must be a branch name or a full commit SHA.");
      }
      readGit(["check-ref-format", `refs/heads/${ref}`]);
      ref = `refs/remotes/origin/${ref}`;
    }
    revision = validateRevision(
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
    assertAncestor(
      readGit,
      revision,
      approvedTip,
      "docs-ref must be reachable from the protected main branch."
    );
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
  }
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

const fetchRegistryJson = async (
  url: string,
  unavailableMessage: string,
  oversizedMessage: string
): Promise<string> => {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(unavailableMessage);
  }
  const text = await response.text();
  if (text.length > 1_048_576) {
    throw new Error(oversizedMessage);
  }
  return text;
};

if (import.meta.main) {
  const version = process.env["DOCS_VERSION"] ?? "";
  const artifact = process.env["BUILD_ARTIFACT"] ?? "";
  let release: ReturnType<typeof resolveDocumentationRevision>;
  if (artifact === "") {
    validateVersion(version);
    const metadata = await fetchRegistryJson(
      `https://registry.npmjs.org/${encodedPackageName}/${version}`,
      "The exact package version is unavailable from npm.",
      "npm returned oversized package metadata."
    );
    const attestations = await fetchRegistryJson(
      expectedAttestationsUrl(version),
      "npm provenance attestations are unavailable for this package version.",
      "npm returned oversized provenance attestations."
    );
    release = resolveDocumentationRevision(
      version,
      process.env["DOCS_REF"] ?? "",
      metadata,
      attestations,
      (args) => capture("git", args)
    );
  } else {
    if (
      artifact !== "documentation-build" ||
      process.env["GITHUB_EVENT_NAME"] !== "push" ||
      process.env["GITHUB_REF"] !== "refs/heads/main"
    ) {
      throw new Error(
        "Automatic documentation must use the release run's CI artifact."
      );
    }
    release = {
      revision: validateRevision(process.env["GITHUB_SHA"] ?? ""),
      version: publishedRootVersion(
        readFileSync("package.json", "utf-8"),
        process.env["PUBLISHED_PACKAGES"] ?? ""
      ),
    };
  }
  const output = process.env["GITHUB_OUTPUT"];
  if (output === undefined || output === "") {
    throw new Error("GITHUB_OUTPUT is required.");
  }
  appendFileSync(
    output,
    `revision=${release.revision}\nversion=${release.version}\n`
  );
}
