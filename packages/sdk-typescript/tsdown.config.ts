import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // Bundle OpenTelemetry deps so consumers (e.g. Convex) don't need to
  // resolve them — their bundlers may not handle transitive deps correctly.
  deps: {
    alwaysBundle: [/^@opentelemetry/],
  },
});
