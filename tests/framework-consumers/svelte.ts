import {
  createInfiniteQuery,
  createMutation,
  createQuery,
} from "@tanstack/svelte-query";
import { skipToken } from "@ueberbrot/effect-api-query";

import {
  http,
  rpc,
  seed,
  type Assert,
  type Equal,
  type HttpError,
  type RpcError,
  type User,
} from "./contracts.js";

export const createConsumers = (id: () => number | undefined) => {
  const selected = createQuery(() =>
    rpc.users.read.queryOptions({
      input: id() === undefined ? skipToken : { id: id() ?? 1 },
      select: (user) => user.name,
    })
  );
  true satisfies Assert<Equal<typeof selected.data, string | undefined>>;
  true satisfies Assert<Equal<typeof selected.error, RpcError | null>>;

  const seeded = createQuery(() =>
    http.users.read.queryOptions({
      input: { params: { id: id() ?? 1 } },
      initialData: seed,
    })
  );
  true satisfies Assert<Equal<typeof seeded.data, User>>;
  true satisfies Assert<Equal<typeof seeded.error, HttpError | null>>;

  const optional = createQuery(() =>
    rpc.users.read.queryOptions({
      input: { id: 1 },
      initialData: (): User | undefined => undefined,
    })
  );
  true satisfies Assert<Equal<typeof optional.data, User | undefined>>;

  const pages = createInfiniteQuery(() =>
    rpc.users.read.infiniteOptions({
      initialPageParam: 1,
      input: (page) => ({ id: page }),
      getNextPageParam: (_last, _all, page) => page + 1,
    })
  );
  const page: User | undefined = pages.data?.pages[0];
  const cursor: number | undefined = pages.data?.pageParams[0];
  void [page, cursor];

  const metadata = createQuery(() =>
    http.users.read.metadataOptions({
      input: { params: { id: 1 } },
      select: (response) => response.status,
    })
  );
  true satisfies Assert<Equal<typeof metadata.data, number | undefined>>;

  const live = createQuery(() =>
    rpc.users.watch.liveOptions({ input: { id: 1 } })
  );
  const history = createQuery(() =>
    rpc.users.watch.streamedOptions({ input: { id: 1 }, maxChunks: 10 })
  );
  true satisfies Assert<Equal<typeof live.data, User | undefined>>;
  true satisfies Assert<
    Equal<typeof history.data, readonly User[] | undefined>
  >;

  const mutation = createMutation(() =>
    http.users.write.mutationOptions({
      onMutate: (input) => ({ previousId: input.payload.id }),
      onError: (_error, input, context) => {
        input.payload.id satisfies number;
        context?.previousId satisfies number | undefined;
      },
    })
  );
  mutation.mutate({ payload: seed });
  // @ts-expect-error Mutation variables use decoded HTTP input.
  mutation.mutate(seed);
};
