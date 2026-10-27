import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.API_URL ?? "http://localhost:4000";

// La tienda habla con la API a través de /api: en desarrollo Vite reenvía las
// peticiones al backend, así las cookies de sesión funcionan sin CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": API,
      "/uploads": API,
    },
  },
  preview: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
