import "dotenv/config";
import { defineConfig } from "evalite/config";

export default defineConfig({
  scoreThreshold: 70,
  trialCount: 1,
  maxConcurrency: 2,
  testTimeout: 120_000,
  cache: true,
});
