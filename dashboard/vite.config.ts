import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the browser talks to this dev server only. /api and /mcp are forwarded to the gateway, so the
// page and the API share one origin, exactly like in the cluster (Ingress routes /api and /mcp to the gateway).
// Default target: the k3d Ingress on this machine, with the Host header the Ingress rule expects.
const target = process.env.GATEWAY_URL ?? "http://127.0.0.1";
const host = process.env.GATEWAY_HOST ?? "app.localhost";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: false, headers: { Host: host } },
      "/mcp": { target, changeOrigin: false, headers: { Host: host } },
    },
  },
});
