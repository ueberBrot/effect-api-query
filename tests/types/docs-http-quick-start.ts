import { MutationObserver, QueryClient } from "@tanstack/query-core";
import {
  configureUtils,
  createHttpApiQueryUtils,
  prepareInput,
} from "@ueberbrot/effect-api-query";
import { ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { usersApi } from "./docs-http-quick-start-contract.ts";

const runtime = ManagedRuntime.make(FetchHttpClient.layer);
const queryClient = new QueryClient();

try {
  const client = await runtime.runPromise(
    HttpApiClient.make(usersApi, { baseUrl: "http://localhost:3000" })
  );
  const http = createHttpApiQueryUtils(usersApi, {
    client,
    keyPrefix: ["users-app"] as const,
    runPromiseExit: runtime.runPromiseExit,
  });

  const user = await queryClient.query(
    http.users.get.queryOptions({
      input: { params: { id: 1 }, query: { locale: "en" } },
    })
  );
  console.log(user.name);

  const read = configureUtils(http.users.get, {
    query: { policy: { staleTime: 30_000 } },
  });
  const prepared = prepareInput(http.users.get, {
    params: { id: 1 },
    query: { locale: "en" },
  });
  const sameUser = await queryClient.query(
    read.queryOptions({ input: prepared })
  );
  console.log(sameUser.name);

  const createUser = new MutationObserver(
    queryClient,
    http.users.create.mutationOptions()
  );
  const created = await createUser.mutate({ payload: { name: "Ada" } });
  console.log(created.id);
  await queryClient.invalidateQueries({ queryKey: http.users.key() });
} finally {
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    await runtime.dispose();
  }
}
