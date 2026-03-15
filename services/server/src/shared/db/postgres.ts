import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../../env.js";
import * as schema from "./schema.js";

const client = postgres(env.databaseUrl);
export const db = drizzle({ client, schema });

export async function runMigrations() {
  const migrationClient = postgres(env.databaseUrl, { max: 1 });
  const migrationDb = drizzle({ client: migrationClient });
  await migrate(migrationDb, { migrationsFolder: "./drizzle" });
  await migrationClient.end();
}
