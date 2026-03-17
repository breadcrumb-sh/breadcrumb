import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    proxy: {
      "/trpc": "http://localhost:3100",
      "/api": "http://localhost:3100",
      "/v1": "http://localhost:3100",
      "/mcp": "http://localhost:3100",
      "/ext": "http://localhost:3100",
    },
  },
});
