import {
  acquireQueryOwner,
  queryEffects,
  QueryClientService,
} from "@ueberbrot/effect-api-query";
import type {
  QueryOwner,
  RunPromiseExit,
  WrapRunnerOptions,
} from "@ueberbrot/effect-api-query";
import { Context, Effect } from "effect";

class Environment extends Context.Service<
  Environment,
  { readonly value: string }
>()("OwnerEnvironment") {}
declare const needsEnvironment: Effect.Effect<string, never, Environment>;
declare const runner: RunPromiseExit<Environment>;
const interruptibleOptions: WrapRunnerOptions = { interruptOnRetire: true };

const owner = await acquireQueryOwner(async (setup) => {
  const borrowed = setup.borrow({ tenant: "a" as const });
  const run = setup.wrapRunner(runner);
  const interruptibleRun = setup.wrapRunner(runner, interruptibleOptions);
  const result = await run(Effect.succeed(1));
  result satisfies import("effect").Exit.Exit<number, never>;
  const interruptibleResult = await interruptibleRun(Effect.succeed(1));
  interruptibleResult satisfies import("effect").Exit.Exit<number, never>;
  await setup.acquire(
    async () => borrowed,
    async (resource) => {
      resource.tenant satisfies "a";
    }
  );
  return borrowed;
});
owner satisfies QueryOwner<{ tenant: "a" }>;
owner.runMutation(async () => 1) satisfies Promise<number>;
// @ts-expect-error Resources preserve their acquired type.
owner.resources.tenant satisfies "b";
// @ts-expect-error Acquiring a resource requires an explicit release policy.
await acquireQueryOwner(async (setup) => setup.acquire(async () => 1));
owner.wrapRunner(runner) satisfies RunPromiseExit<Environment>;
owner.wrapRunner(runner, {
  interruptOnRetire: true,
}) satisfies RunPromiseExit<Environment>;
owner.wrapRunner(runner, {
  interruptOnRetire: false,
}) satisfies RunPromiseExit<Environment>;
await owner.wrapRunner(runner)(needsEnvironment);
await owner.wrapRunner(runner, { interruptOnRetire: true })(needsEnvironment);
const cacheRead = queryEffects.getData<string>(["owner"]);
Effect.runPromise(
  cacheRead.pipe(Effect.provideService(QueryClientService, owner.queryClient))
) satisfies Promise<string | undefined>;
await owner.dispose();
