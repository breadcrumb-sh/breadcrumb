import postgres from 'postgres';

let _initPromise: Promise<ReturnType<typeof postgres>> | null = null;

async function init(): Promise<ReturnType<typeof postgres>> {
  const url = import.meta.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 5 });
  await sql`
    CREATE TABLE IF NOT EXISTS waitlist (
      id         SERIAL PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      deploy     TEXT,
      scale      TEXT,
      comments   TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  return sql;
}

export function getDb(): Promise<ReturnType<typeof postgres>> {
  if (!_initPromise) _initPromise = init();
  return _initPromise;
}
