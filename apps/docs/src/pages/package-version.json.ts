import type { APIRoute } from "astro";

import packageManifest from "../../../../package.json" with { type: "json" };

export const GET: APIRoute = () =>
  Response.json({
    name: packageManifest.name,
    version: packageManifest.version,
  });
