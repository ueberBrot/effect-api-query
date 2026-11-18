import { QueryClient } from "@tanstack/query-core";
import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
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
} finally {
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    await runtime.dispose();
  }
}
