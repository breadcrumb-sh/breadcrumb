import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@breadcrumb-sdk/core": resolve(__dirname, "../sdk-typescript/src/index.ts"),
    },
  },
  test: {
    globals: true,
  },
});
