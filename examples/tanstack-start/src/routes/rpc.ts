import { createFileRoute } from "@tanstack/react-router";

import { handleApiRequest } from "../lib/api-server.ts";

export const Route = createFileRoute("/rpc")({
  server: {
    handlers: {
      POST: async ({ request }) => await handleApiRequest(request),
    },
  },
});
