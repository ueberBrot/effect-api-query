import { QueryClient } from "@tanstack/query-core";
import { useQuery } from "@tanstack/react-query";
import {
  createQueryDescriptor,
  createRpcQueryUtils,
  prepareInput,
  type InferInput,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const input = Schema.Struct({ id: Schema.Int });
const group = RpcGroup.make(
  Rpc.make("read", {
    payload: input,
    success: Schema.Struct({ name: Schema.String }),
  })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["loader-types"] });
const registration = createQueryDescriptor(rpc.read, "query", {
  contract: "v1",
  input,
});
const descriptor = registration.capture({ id: 1 });
const bound = registration.bind(descriptor);
const cache = new QueryClient();
const data: Promise<{ readonly name: string }> = cache.query(
  bound.leaf.queryOptions({ input: bound.input })
);
const view: "query" = bound.view;
const Component = () => {
  const result = useQuery(
    bound.leaf.queryOptions({
      input: bound.input,
      select: (value) => value.name.length,
    })
  );
  const length: number | undefined = result.data;
  return length;
};
// @ts-expect-error Descriptor input retains the operation's exact input.
registration.capture({ id: "wrong" });
// @ts-expect-error Prepared tokens cannot be transported as descriptor input.
registration.capture(prepareInput(rpc.read, { id: 1 }));
// @ts-expect-error This buffered RPC has no live view.
createQueryDescriptor(rpc.read, "live", { contract: "v1", input });
createQueryDescriptor(rpc.read, "query", {
  contract: "v1",
  // @ts-expect-error Input codecs must decode the selected operation's input.
  input: Schema.String,
});
void data;
void view;
void Component;

declare const serviceCodec: Schema.Codec<
  InferInput<typeof rpc.read>,
  unknown,
  "CodecService"
>;
createQueryDescriptor(rpc.read, "query", {
  contract: "v1",
  // @ts-expect-error Descriptor codecs must be service-free for synchronous rebinding.
  input: serviceCodec,
});
