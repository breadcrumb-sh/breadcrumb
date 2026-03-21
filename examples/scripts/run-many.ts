/**
 * run-many — runs example scripts in random order to seed trace data
 *
 * Usage:
 *   npm run run-many --workspace=examples
 *   RUNS=50 npm run run-many --workspace=examples
 *   CONCURRENCY=5 RUNS=50 npm run run-many --workspace=examples
 *
 * Run: npm run run-many --workspace=examples
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "..");

const SCRIPTS = [
  "01-sdk-simple.ts",
  "02-sdk-complex.ts",
  "03-sdk-error.ts",
  "04-ai-sdk-simple.ts",
  "05-ai-sdk-complex.ts",
  "06-sdk-huge-trace.ts",
];

const TOTAL = parseInt(process.env["RUNS"] ?? "30", 10);
const CONCURRENCY = parseInt(process.env["CONCURRENCY"] ?? "3", 10);


// ── Helpers ───────────────────────────────────────────────────────────────────

function pickRandom(): string {
  return SCRIPTS[Math.floor(Math.random() * SCRIPTS.length)];
}

function runScript(script: string): Promise<{ ok: boolean; ms: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    // Use node --import tsx to avoid platform-specific .cmd issues
    const child = spawn(process.execPath, ["--import", "tsx", join(__dirname, script)], {
      stdio: "pipe",
      cwd: examplesDir,
      env: process.env,
    });

    child.on("close", (code) => resolve({ ok: code === 0, ms: Date.now() - start }));
    child.on("error", () => resolve({ ok: false, ms: Date.now() - start }));
  });
}

// ── Pool runner ───────────────────────────────────────────────────────────────

const queue = Array.from({ length: TOTAL }, pickRandom);
let completed = 0;
let succeeded = 0;
let failed = 0;

async function worker() {
  while (queue.length > 0) {
    const script = queue.shift()!;
    const { ok, ms } = await runScript(script);
    const n = ++completed;
    const label = basename(script, ".ts");
    const time = (ms / 1000).toFixed(1) + "s";
    console.log(ok ? `[${n}/${TOTAL}] ✓ ${label} (${time})` : `[${n}/${TOTAL}] ✗ ${label} (${time})`);
    ok ? succeeded++ : failed++;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log(`Seeding ${TOTAL} traces across ${SCRIPTS.length} scripts (concurrency: ${CONCURRENCY})\n`);

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\n${succeeded} succeeded, ${failed} failed`);
