import { createFileRoute } from "@tanstack/react-router";

import { handleApiRequest } from "../lib/api-server.ts";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleApiRequest(request),
      POST: async ({ request }) => await handleApiRequest(request),
      DELETE: async ({ request }) => await handleApiRequest(request),
    },
  },
});
