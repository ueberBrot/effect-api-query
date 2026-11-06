import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { redact } from "@tanstack/redact/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import type { PreviewServer } from "vite-plus";

export default defineConfig({
  plugins: [
    {
      name: "preserve-api-request-cancellation",
      configurePreviewServer(server: PreviewServer) {
        server.middlewares.use((request, _response, next) => {
          const path = request.url?.split("?")[0] ?? "";
          if (path.startsWith("/api/") || path === "/rpc" || path === "/rpc/") {
            request.headers["accept-encoding"] = "identity";
          }
          next();
        });
      },
    },
    tanstackStart(),
    tailwindcss(),
    react(),
    redact(),
  ],
  ssr: {
    noExternal: [/^@tanstack\//u],
  },
  preview: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
});
