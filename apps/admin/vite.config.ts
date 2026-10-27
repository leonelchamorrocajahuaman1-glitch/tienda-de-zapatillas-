import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.API_URL ?? "http://localhost:4000";

// Redirige http://localhost:5174/ y /admin → /admin/
const redirectRoot: Plugin = {
  name: "redirect-root",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === "/" || req.url === "" || req.url === "/admin") {
        res.statusCode = 302;
        res.setHeader("Location", "/admin/");
        res.end();
        return;
      }
      next();
    });
  },
};

// El panel vive bajo /admin tanto en desarrollo como en producción.
export default defineConfig({
  base: "/admin/",
  plugins: [react(), redirectRoot],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": API,
      "/uploads": API,
    },
  },
  preview: { port: 5174 },
  build: { chunkSizeWarningLimit: 1500 },
});
