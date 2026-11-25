import { defineConfig } from "deepsec/config";

import { generatedMatchersPlugin } from "./generated-matchers.js";

export default defineConfig({
  defaultThinkingLevel: "high", // <deepsec:default-thinking-level>
  defaultModel: "gpt-6.2-sol", // <deepsec:default-model>
  defaultAgent: "codex", // <deepsec:default-agent>
  ai: { mode: "local", provider: "local" }, // <deepsec:model-route>
  projects: [
    { id: "effect-api-query", root: ".." },
    // <deepsec:projects-insert-above>
  ],
  plugins: [generatedMatchersPlugin],
});
