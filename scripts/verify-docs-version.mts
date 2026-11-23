import { existsSync, readFileSync } from "node:fs";

export const packageName = "@ueberbrot/effect-api-query";
const versionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*))*)?$/u;

export const validateVersion = (version: string): string => {
  if (version.length > 128 || !versionPattern.test(version)) {
    throw new Error("An exact npm version is required.");
  }
  return version;
};

export const parseManifest = (json: string) => {
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

const verifyDocumentationVersion = (
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
  const metadataPath = "apps/docs/dist/package-version.json";
  verifyDocumentationVersion(
    existsSync(metadataPath) ? readFileSync(metadataPath, "utf-8") : undefined,
    version
  );
}
