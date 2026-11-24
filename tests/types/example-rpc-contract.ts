import type { ExampleRpcClient } from "@effect-api-query/contracts/client";

type AssertNever<T extends never> = T;

type _FixtureMethods = AssertNever<
  Extract<"testing.seed" | "testing.reset", keyof ExampleRpcClient>
>;
