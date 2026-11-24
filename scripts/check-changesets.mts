import { readChangesets } from "@changesets/read";

export const checkChangesets = async (cwd: string) => {
  const invalid: string[] = [];
  for (const { id, summary } of await readChangesets(cwd)) {
    const withoutPull = summary.replace(
      /^\s*(?:pr|pull|pull\s+request):\s*#?\d+/imu,
      ""
    );
    const directive = /^\s*commit:[^\S\r\n\u2028\u2029]*(?<sha>[^\s]*)/imu.exec(
      withoutPull
    );
    if (
      directive &&
      !/^[a-f0-9]{4,40}$/iu.test(directive.groups?.["sha"] ?? "")
    ) {
      invalid.push(
        `.changeset/${id}.md: invalid commit directive. Use a hexadecimal Git commit SHA on the same line.`
      );
    }
  }
  if (invalid.length > 0) {
    throw new Error(invalid.join("\n"));
  }
};

if (import.meta.main) {
  await checkChangesets(process.cwd());
}
