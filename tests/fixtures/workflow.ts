import { readFileSync } from "node:fs";

import { isAlias, isMap, isNode, isSeq, parseDocument } from "yaml";

export const readWorkflow = (
  name: "ci" | "deploy-docs" | "playwright" | "release"
) => {
  const workflow = parseDocument(
    readFileSync(
      new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
      "utf-8"
    )
  );
  if (workflow.errors.length > 0) {
    throw new AggregateError(workflow.errors, `Invalid workflow ${name}`);
  }
  return workflow;
};

export const workflowSteps = (
  workflow: ReturnType<typeof readWorkflow>,
  job: string
) => {
  const steps = workflow.getIn(["jobs", job, "steps"], true);
  if (!isSeq(steps)) {
    throw new Error(`Missing workflow steps for ${job}`);
  }
  return steps.items
    .map((step) => (isAlias(step) ? step.resolve(workflow) : step))
    .filter(isMap);
};

export const workflowValue = (
  workflow: ReturnType<typeof readWorkflow>,
  fields: readonly string[]
) => {
  const node = workflow.getIn(fields, true);
  const value: unknown = isNode(node) ? node.toJSON() : node;
  return value;
};
