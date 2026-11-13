import { ok } from "node:assert/strict";

export const assertBudget = (
  name: string,
  actual: number,
  maximum: number
): void => {
  ok(actual <= maximum, `${name}: ${actual} exceeds budget ${maximum}`);
};

export const bundleBudgets = {
  rpc: { included: [37_300, 12_200], external: [20_200, 7100] },
  http: { included: [45_500, 14_500], external: [26_200, 8800] },
  streamed: { included: [27_800, 8900], external: [20_200, 7100] },
  hydration: { included: [39_600, 12_900], external: [21_900, 7700] },
} as const;

export const compilerBudgets = new Map(
  Object.entries({
    "current/rpc/50/contract": 56_292,
    "current/rpc/50/raw": 48_891,
    "current/rpc/50/configured": 65_922,
    "current/rpc/250/contract": 271_232,
    "current/rpc/250/raw": 194_531,
    "current/rpc/250/configured": 237_082,
    "current/rpc/1000/contract": 1_077_257,
    "current/rpc/1000/raw": 740_681,
    "current/rpc/1000/configured": 878_932,
    "current/http/50/contract": 10_058,
    "current/http/50/raw": 130_615,
    "current/http/50/configured": 146_111,
    "current/http/250/contract": 36_898,
    "current/http/250/raw": 709_434,
    "current/http/250/configured": 742_751,
    "current/http/1000/contract": 137_548,
    "current/http/1000/raw": 5_231_259,
    "current/http/1000/configured": 5_331_401,
    "minimum/rpc/50/contract": 56_292,
    "minimum/rpc/50/raw": 48_742,
    "minimum/rpc/50/configured": 65_755,
    "minimum/rpc/250/contract": 271_232,
    "minimum/rpc/250/raw": 194_382,
    "minimum/rpc/250/configured": 236_915,
    "minimum/rpc/1000/contract": 1_077_257,
    "minimum/rpc/1000/raw": 740_532,
    "minimum/rpc/1000/configured": 878_765,
    "minimum/http/50/contract": 10_072,
    "minimum/http/50/raw": 128_050,
    "minimum/http/50/configured": 143_533,
    "minimum/http/250/contract": 36_912,
    "minimum/http/250/raw": 700_270,
    "minimum/http/250/configured": 733_573,
    "minimum/http/1000/contract": 137_562,
    "minimum/http/1000/raw": 5_197_345,
    "minimum/http/1000/configured": 5_297_473,
  })
);
