import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));

const firstLine = (content: string) => content.split(/\r?\n/u, 1)[0] ?? "";

describe("packed React subpath isolation", () => {
  it("emits 'use client' on line 1 of dist/react.mjs only", () => {
    const reactEntry = readFileSync(path.join(distDir, "react.mjs"), "utf-8");
    expect(firstLine(reactEntry)).toMatch(/^['"]use client['"];?$/u);

    const jsOutputs = readdirSync(distDir).filter(
      (entry) => entry.endsWith(".mjs") && entry !== "react.mjs"
    );
    expect(jsOutputs).toContain("index.mjs");
    for (const file of jsOutputs) {
      const content = readFileSync(path.join(distDir, file), "utf-8");
      expect(content).not.toMatch(/['"]use client['"]/u);
    }
  });

  it("keeps dist/index.{mjs,d.mts} and shared chunks free of React and React Query references", () => {
    const coreOutputs = readdirSync(distDir).filter(
      (entry) =>
        (entry.endsWith(".mjs") || entry.endsWith(".d.mts")) &&
        entry !== "react.mjs" &&
        entry !== "react.d.mts"
    );
    expect(coreOutputs).toContain("index.mjs");
    expect(coreOutputs).toContain("index.d.mts");

    const forbidden = [
      /['"]react['"]/u,
      /['"]react\/jsx-runtime['"]/u,
      /['"]@tanstack\/react-query['"]/u,
      /\bReact\./u,
    ];

    for (const file of coreOutputs) {
      const content = readFileSync(path.join(distDir, file), "utf-8");
      for (const pattern of forbidden) {
        expect(content).not.toMatch(pattern);
      }
    }
  });
});
