import { createClient } from "@clickhouse/client";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../../env.js";

// Client is connected to the breadcrumb database for all normal queries.
export const clickhouse = createClient({
  url: env.clickhouseUrl,
  username: env.clickhouseUser,
  password: env.clickhousePassword,
  database: env.clickhouseDb,
  application: "breadcrumb-server",
  max_open_connections: 20,
  request_timeout: 60_000,
  compression: {
    response: true,
    request: true,
  },
  keep_alive: {
    enabled: true,
    idle_socket_ttl: 2500,
  },
});

// Read-only client for all SELECT queries. ClickHouse enforces readonly=1 at
// the server level — no DDL, no DML, no INSERT can slip through regardless of
// what SQL is passed. Use this everywhere user-supplied or AI-generated queries run.
export const readonlyClickhouse = createClient({
  url: env.clickhouseUrl,
  username: env.clickhouseUser,
  password: env.clickhousePassword,
  database: env.clickhouseDb,
  application: "breadcrumb-server-ro",
  max_open_connections: 20,
  request_timeout: 60_000,
  compression: {
    response: true,
    request: true,
  },
  keep_alive: {
    enabled: true,
    idle_socket_ttl: 2500,
  },
  clickhouse_settings: {
    readonly: "1",
  },
});

// Sandboxed client for AI-generated and user-supplied SQL queries.
// Connects as the `ai_query` user which has:
//   - Row policies enforcing project isolation via SQL_project_id setting
//   - readonly=2 (settings changes allowed, writes blocked)
//   - Resource limits (max_execution_time, max_rows_to_read, etc.)
//   - SELECT only on breadcrumb.{traces,spans,trace_rollups}
// Use runSandboxedQuery() from lib/sandboxed-query.ts instead of calling directly.
export const sandboxedClickhouse = createClient({
  url: env.clickhouseUrl,
  username: "ai_query",
  password: env.clickhouseAiQueryPassword,
  database: env.clickhouseDb,
  application: "breadcrumb-server-sandbox",
  max_open_connections: 20,
  request_timeout: 15_000,
  compression: {
    response: true,
    request: true,
  },
  keep_alive: {
    enabled: true,
    idle_socket_ttl: 2500,
  },
});

// Separate client without a database selected, used only during migration
// setup when the database may not exist yet.
const adminClient = createClient({
  url: env.clickhouseUrl,
  username: env.clickhouseUser,
  password: env.clickhousePassword,
});

// Migration tracking table. Lives in the breadcrumb database alongside
// application tables. Stores one row per applied migration.
//
// MergeTree ordered by version makes it trivial to find the latest
// applied migration with: SELECT max(version) FROM schema_migrations
const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS breadcrumb.schema_migrations (
    version     UInt32,
    name        String,
    applied_at  DateTime DEFAULT now()
  ) ENGINE = MergeTree()
  ORDER BY version
`;

// Resolve migration files directory. In dev, the repo root is the cwd.
// In production the Dockerfile copies migrations next to the binary.
const MIGRATIONS_CANDIDATES = [
  "../../infra/clickhouse/migrations",   // dev: run from services/server (tsx watch)
  "./infra/clickhouse/migrations",       // dev: run from repo root
  "./migrations/clickhouse",            // production: copied by Dockerfile
];

async function findMigrationsDir(): Promise<string> {
  for (const candidate of MIGRATIONS_CANDIDATES) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    "Could not find ClickHouse migrations directory. Searched: " +
      MIGRATIONS_CANDIDATES.join(", ")
  );
}

// Parse a migration file into individual statements.
// Rules:
//   - Split on semicolons followed by a newline
//   - Strip leading/trailing whitespace
//   - Drop blank entries and pure-comment lines
//   - The CREATE DATABASE statement is extracted and run separately
//     via adminClient before the rest, since the database must exist
//     before we can reference it in subsequent statements.
function parseStatements(sql: string): { dbStatement: string | null; statements: string[] } {
  const raw = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.replace(/--[^\n]*/g, "").trim().match(/^$/));

  let dbStatement: string | null = null;
  const statements: string[] = [];

  for (const stmt of raw) {
    if (/CREATE DATABASE/i.test(stmt)) {
      dbStatement = stmt;
    } else {
      statements.push(stmt);
    }
  }

  return { dbStatement, statements };
}

export async function runClickhouseMigrations() {
  // Step 1: ensure the database exists (must use adminClient, no db selected)
  await adminClient.command({
    query: `CREATE DATABASE IF NOT EXISTS ${env.clickhouseDb}`,
  });

  // Step 2: ensure the migration tracking table exists
  await clickhouse.command({ query: TRACKING_TABLE });

  // Step 3: find the highest already-applied version
  const result = await clickhouse.query({
    query: "SELECT max(version) AS v FROM breadcrumb.schema_migrations",
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<Record<string, unknown>>;
  const appliedVersion = Number(rows[0]?.["v"] ?? 0);

  // Step 4: find and sort migration files
  const dir = await findMigrationsDir();
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexicographic sort — 0001_ < 0002_ etc.

  // Step 5: apply any migration whose version number exceeds appliedVersion
  let applied = 0;
  for (const file of files) {
    const version = parseInt(file.split("_")[0], 10);
    if (isNaN(version)) continue;
    if (version <= appliedVersion) continue;

    console.log(`applying clickhouse migration: ${file}`);
    const sql = await readFile(join(dir, file), "utf-8");
    const { dbStatement, statements } = parseStatements(sql);

    // Run CREATE DATABASE via adminClient if present in the file
    if (dbStatement) {
      await adminClient.command({ query: dbStatement });
    }

    // Run remaining statements sequentially.
    // ClickHouse has no DDL transactions — if a statement fails the
    // migration is partially applied. Keep each migration file to a
    // single logical change and use IF NOT EXISTS / IF EXISTS guards
    // to make statements idempotent where possible.
    for (const stmt of statements) {
      await clickhouse.command({ query: stmt });
    }

    // Record the migration as applied
    await clickhouse.command({
      query: `INSERT INTO breadcrumb.schema_migrations (version, name) VALUES (${version}, '${file}')`,
    });

    applied++;
  }

  if (applied === 0) {
    console.log("clickhouse migrations: nothing to apply");
  } else {
    console.log(`clickhouse migrations: applied ${applied} migration(s)`);
  }
}
