import { config as loadEnv } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Load examples/.env relative to this file, so the path is correct
// regardless of which directory you run the script from.
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });

const apiKey = process.env["BREADCRUMB_API_KEY"];
if (!apiKey) {
  console.error(
    "Missing BREADCRUMB_API_KEY in examples/.env\n" +
      "Run `npm run seed` in services/server to create a project and key,\n" +
      "then add BREADCRUMB_API_KEY=<key> to examples/.env",
  );
  process.exit(1);
}

export const config = {
  apiKey,
  baseUrl: process.env["BREADCRUMB_BASE_URL"] ?? "http://localhost:3100",
};

export const openrouterApiKey = process.env["OPENROUTER_API_KEY"];

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
