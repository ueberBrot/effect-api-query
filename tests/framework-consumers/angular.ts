import { signal } from "@angular/core";
import {
  injectInfiniteQuery,
  injectMutation,
  injectQuery,
} from "@tanstack/angular-query-experimental";
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

export const injectConsumers = () => {
  const id = signal<number | undefined>(1);
  const selected = injectQuery(() =>
    rpc.users.read.queryOptions({
      input: id() === undefined ? skipToken : { id: id() ?? 1 },
      select: (user) => user.name,
    })
  );
  const selectedData = selected.data();
  const selectedError = selected.error();
  true satisfies Assert<Equal<typeof selectedData, string | undefined>>;
  true satisfies Assert<Equal<typeof selectedError, RpcError | null>>;

  const seeded = injectQuery(() =>
    http.users.read.queryOptions({
      input: { params: { id: id() ?? 1 } },
      initialData: seed,
    })
  );
  const seededData = seeded.data();
  const seededError = seeded.error();
  true satisfies Assert<Equal<typeof seededData, User>>;
  true satisfies Assert<Equal<typeof seededError, HttpError | null>>;

  const optional = injectQuery(() =>
    rpc.users.read.queryOptions({
      input: { id: 1 },
      initialData: (): User | undefined => undefined,
    })
  );
  const optionalData = optional.data();
  true satisfies Assert<Equal<typeof optionalData, User | undefined>>;

  const pages = injectInfiniteQuery(() =>
    rpc.users.read.infiniteOptions({
      initialPageParam: 1,
      input: (page) => ({ id: page }),
      getNextPageParam: (_last, _all, page) => page + 1,
    })
  );
  const page: User | undefined = pages.data()?.pages[0];
  const cursor: number | undefined = pages.data()?.pageParams[0];
  void [page, cursor];

  const metadata = injectQuery(() =>
    http.users.read.metadataOptions({
      input: { params: { id: 1 } },
      select: (response) => response.status,
    })
  );
  const status = metadata.data();
  true satisfies Assert<Equal<typeof status, number | undefined>>;

  const live = injectQuery(() =>
    rpc.users.watch.liveOptions({ input: { id: 1 } })
  );
  const history = injectQuery(() =>
    rpc.users.watch.streamedOptions({ input: { id: 1 }, maxChunks: 10 })
  );
  const latest = live.data();
  const retained = history.data();
  true satisfies Assert<Equal<typeof latest, User | undefined>>;
  true satisfies Assert<Equal<typeof retained, readonly User[] | undefined>>;

  const mutation = injectMutation(() =>
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
