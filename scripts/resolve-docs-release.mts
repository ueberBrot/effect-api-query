import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const packageName = "@ueberbrot/effect-api-query";
const repository = "git+https://github.com/ueberBrot/effect-api-query.git";
const shaPattern = /^[\da-f]{40}$/u;
const versionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*))*)?$/u;

const validateVersion = (version: string): string => {
  if (version.length > 128 || !versionPattern.test(version)) {
    throw new Error("An exact npm version is required.");
  }
  return version;
};

const validateRevision = (revision: string): string => {
  if (!shaPattern.test(revision)) {
    throw new Error("A full lowercase commit SHA is required.");
  }
  return revision;
};

const parseManifest = (json: string) => {
  const manifest: unknown = JSON.parse(json);
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    manifest.name !== packageName ||
    !("version" in manifest) ||
    typeof manifest.version !== "string" ||
    ("private" in manifest && manifest.private === true)
  ) {
    throw new Error("The public root package name and version must match.");
  }
  validateVersion(manifest.version);
  return { ...manifest, name: manifest.name, version: manifest.version };
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

const validateRegistryMetadata = (
  version: string,
  revision: string,
  json: string
): void => {
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
    !/^sha512-[\dA-Za-z+/]{86}==$/u.test(metadata.dist.integrity) ||
    !("tarball" in metadata.dist) ||
    metadata.dist.tarball !==
      `https://registry.npmjs.org/${packageName}/-/effect-api-query-${version}.tgz`
  ) {
    throw new Error(
      "npm metadata must identify this repository's released package."
    );
  }
  if (
    "gitHead" in metadata &&
    (typeof metadata.gitHead !== "string" ||
      validateRevision(metadata.gitHead) !== revision)
  ) {
    throw new Error("npm gitHead does not match the release tag.");
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
    /^e2e-docs\/.+$/u.test(path) ||
    path === "playwright.docs.config.ts" ||
    path === "tests/docs-examples.test.ts" ||
    /^tests\/types\/docs-[^/]+\.(?:ts|tsx)$/u.test(path)
  );
};

export const resolveDocumentationRevision = (
  version: string,
  docsRef: string,
  metadata: string,
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
  validateRegistryMetadata(version, release, metadata);
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
    readGit(["merge-base", "--is-ancestor", release, revision]);
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
    "e2e-docs",
    "playwright.docs.config.ts",
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

export const verifyDocumentationVersion = (
  json: string | undefined,
  version: string
): void => {
  if (json === undefined) {
    throw new Error(
      "The documentation build must emit package-version.json. For a legacy release, supply docs-ref with the static package version badge and JSON metadata."
    );
  }
  if (parseManifest(json).version !== validateVersion(version)) {
    throw new Error(
      "The documentation build is for a different package version."
    );
  }
};

if (import.meta.main) {
  const version = process.env["DOCS_VERSION"] ?? "";
  if (process.argv[2] === "verify-build") {
    const metadataPath = "apps/docs/dist/package-version.json";
    verifyDocumentationVersion(
      existsSync(metadataPath)
        ? readFileSync(metadataPath, "utf-8")
        : undefined,
      version
    );
  } else {
    const artifact = process.env["BUILD_ARTIFACT"] ?? "";
    let release: ReturnType<typeof resolveDocumentationRevision>;
    if (artifact === "") {
      validateVersion(version);
      const response = await fetch(
        `https://registry.npmjs.org/@ueberbrot%2feffect-api-query/${version}`,
        { redirect: "error", signal: AbortSignal.timeout(15_000) }
      );
      if (!response.ok) {
        throw new Error("The exact package version is unavailable from npm.");
      }
      const metadata = await response.text();
      if (metadata.length > 1_048_576) {
        throw new Error("npm returned oversized package metadata.");
      }
      release = resolveDocumentationRevision(
        version,
        process.env["DOCS_REF"] ?? "",
        metadata,
        (args) => execFileSync("git", args, { encoding: "utf-8" })
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
}
