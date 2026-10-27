import { QueryClient } from "@tanstack/query-core";
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const indexes = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
  60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
  79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97,
  98, 99,
] as const;

const operation = <const Tag extends string>(tag: Tag) =>
  Rpc.make(tag, {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  });
const group = RpcGroup.make(
  ...indexes.flatMap((index) => [
    operation(`scale.read-${index}-0`),
    operation(`scale.read-${index}-1`),
    operation(`scale.read-${index}-2`),
    operation(`scale.read-${index}-3`),
    operation(`scale.read-${index}-4`),
    operation(`scale.read-${index}-5`),
    operation(`scale.read-${index}-6`),
    operation(`scale.read-${index}-7`),
    operation(`scale.read-${index}-8`),
    operation(`scale.read-${index}-9`),
  ])
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const utils = createRpcQueryUtils(group, {
  client,
  keyPrefix: ["large-contract"],
});
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;
type OperationName =
  `read-${(typeof indexes)[number]}-${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;
true satisfies Assert<
  Equal<Exclude<keyof typeof utils.scale, "key">, OperationName>
>;
utils.scale["read-99-9"].key() satisfies readonly [
  "large-contract",
  "rpc",
  "scale",
  "read-99-9",
];
const first = utils.scale["read-0-0"].queryOptions({ input: { id: 1 } });
const last = utils.scale["read-99-9"].queryOptions({
  input: { id: 2 },
  select: (user) => user.name,
});
const cached = new QueryClient().getQueryData(last.queryKey);
const id: number | undefined = cached?.id;
const selected: string | undefined = last.select?.({ id: 2, name: "Ada" });
// @ts-expect-error Every generated operation retains its payload type.
utils.scale["read-99-9"].queryOptions({ input: { id: "2" } });
// @ts-expect-error The tree contains only declared operation names.
utils.scale["read-100-0"];

void [first, id, selected];
