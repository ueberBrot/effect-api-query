import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { startUsersApplication } from "./docs-react-client.ts";
import type { UsersApplication } from "./docs-react-client.ts";

const User = ({ application }: { readonly application: UsersApplication }) => {
  const user = useQuery(
    application.http.users.get.queryOptions({ input: { params: { id: 1 } } })
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
    <QueryClientProvider client={application.queryClient}>
      <User application={application} />
    </QueryClientProvider>
  );
  return async () => {
    root.unmount();
    await application.dispose();
  };
};
