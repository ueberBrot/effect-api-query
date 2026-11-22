import { useQuery } from "@tanstack/react-query";
import { createQueryUtilsContext } from "@ueberbrot/effect-api-query/react";
import { createRoot } from "react-dom/client";

import { startUsersApplication } from "./docs-react-client.ts";
import type { UsersApplication } from "./docs-react-client.ts";

const { Provider, useQueryUtils } =
  createQueryUtilsContext<UsersApplication["resources"]>();

const User = () => {
  const http = useQueryUtils();
  const user = useQuery(
    http.users.get.queryOptions({ input: { params: { id: 1 } } })
  );
  if (user.isPending) {
    return <p>Loading user…</p>;
  }
  if (user.isError) {
    return <p role="alert">Could not load the user.</p>;
  }
  return <h1>{user.data.name}</h1>;
};

export const mountUsersApplication = async (
  element: HTMLElement,
  baseUrl: string
) => {
  const application = await startUsersApplication(baseUrl);
  const root = createRoot(element);
  root.render(
    <Provider owner={application}>
      <User />
    </Provider>
  );
  return async () => {
    root.unmount();
    await application.dispose();
  };
};
