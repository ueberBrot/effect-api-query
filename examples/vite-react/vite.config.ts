import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

const apiProxy = {
  "/api": { target: "http://127.0.0.1:3001", changeOrigin: false },
  "/rpc": { target: "http://127.0.0.1:3001", changeOrigin: false },
};

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: apiProxy,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: apiProxy,
    strictPort: true,
  },
});
