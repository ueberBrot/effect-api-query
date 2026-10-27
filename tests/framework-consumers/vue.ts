import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/vue-query";
import { skipToken } from "@ueberbrot/effect-api-query";
import { computed, ref } from "vue";

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

export const useConsumers = () => {
  const id = ref<number | undefined>(1);
  const selected = useQuery(
    computed(() =>
      rpc.users.read.queryOptions({
        input: id.value === undefined ? skipToken : { id: id.value },
        select: (user) => user.name,
      })
    )
  );
  true satisfies Assert<Equal<typeof selected.data.value, string | undefined>>;
  true satisfies Assert<Equal<typeof selected.error.value, RpcError | null>>;

  const seeded = useQuery(
    computed(() =>
      http.users.read.queryOptions({
        input: { params: { id: id.value ?? 1 } },
        initialData: seed,
      })
    )
  );
  const nativeSeeded = useQuery(
    computed(() => ({
      queryKey: ["native-seed"],
      queryFn: async () => seed,
      initialData: seed,
    }))
  );
  true satisfies Assert<
    Equal<typeof nativeSeeded.data.value, User | undefined>
  >;
  true satisfies Assert<
    Equal<typeof seeded.data.value, typeof nativeSeeded.data.value>
  >;
  true satisfies Assert<Equal<typeof seeded.error.value, HttpError | null>>;

  const defined = useQuery(
    http.users.read.queryOptions({
      input: { params: { id: 1 } },
      initialData: seed,
    })
  );
  true satisfies Assert<Equal<typeof defined.data.value, User>>;

  const optional = useQuery(
    computed(() =>
      rpc.users.read.queryOptions({
        input: { id: 1 },
        initialData: (): User | undefined => undefined,
      })
    )
  );
  true satisfies Assert<Equal<typeof optional.data.value, User | undefined>>;

  const pages = useInfiniteQuery(
    computed(() =>
      rpc.users.read.infiniteOptions({
        initialPageParam: 1,
        input: (page) => ({ id: page }),
        getNextPageParam: (_last, _all, page) => page + 1,
      })
    )
  );
  const page: User | undefined = pages.data.value?.pages[0];
  const cursor: number | undefined = pages.data.value?.pageParams[0];
  void [page, cursor];

  const live = useQuery(
    computed(() => rpc.users.watch.liveOptions({ input: { id: 1 } }))
  );
  const history = useQuery(
    computed(() =>
      rpc.users.watch.streamedOptions({ input: { id: 1 }, maxChunks: 10 })
    )
  );
  true satisfies Assert<Equal<typeof live.data.value, User | undefined>>;
  true satisfies Assert<
    Equal<typeof history.data.value, readonly User[] | undefined>
  >;

  const mutation = useMutation(
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
