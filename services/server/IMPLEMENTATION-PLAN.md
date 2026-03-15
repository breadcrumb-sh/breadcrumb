# Server Implementation Plan

## Straightforward Fixes (no discussion needed)

These will be implemented as-is:

- [ ] 1. All 16 `traces.*` endpoints unauthenticated → `orgViewerProcedure`
- [ ] 2. `explores.chat` doesn't verify explore belongs to project → add DB check
- [ ] 3. `explores.get` uses `procedure` with manual auth → switch to `orgViewerProcedure`
- [ ] 4. `requery` exposes raw ClickHouse errors → wrap in try/catch
- [ ] 5. Session middleware on ingest hot path → skip `/v1/*`, `/mcp`, `/health`
- [ ] 6. `trustedOrigins` includes localhost in production → conditional on `nodeEnv`
- [ ] 7. No security headers → add `hono/secure-headers`
- [ ] 8. CORS ordering — auth route registered before CORS → fix order
- [ ] 9. CORS allows unnecessary DELETE method → remove from allowMethods
- [ ] 10. `toMicroDollars` falsy check → `usd == null` instead of `!usd`
- [ ] 11. `spanSample` unbounded result → add LIMIT to trace IDs query
- [ ] 12. SPA `index.html` read from disk per request → cache in memory
- [ ] 13. `stats` sequential queries → `Promise.all` for current + previous period
- [ ] 14. Remove `jose` dead dependency → delete from package.json
- [ ] 15. Invitation dupe check doesn't filter expired → add expiry filter
- [ ] 16. `traceId` input not validated as hex → add `.regex()` validation
- [ ] 17. Ingest swallows JSON parse errors → return distinct 400 for malformed JSON
- [ ] 18. Shutdown doesn't close DB connections → add cleanup
- [ ] 19. `projects.create` slug collision → append random suffix

---

## Needs Input

### ~~A + B. Sandboxed ClickHouse client for AI/user SQL~~ DONE

**Problem:** AI-generated SQL and user-supplied SQL (`run_query`, `requery`, `writeSearchQuery`)
can read cross-project data and have no resource limits.

**Solution:** ClickHouse row policies + per-query custom settings. Tested and verified locally.

**How it works:**
- A dedicated `ai_query` CH user with row policies on all 3 tables
- Row policies use `project_id = toUUID(getSetting('SQL_project_id'))`
- The `SQL_project_id` setting is passed per-query via `clickhouse_settings` (no sessions needed)
- ClickHouse enforces the filter at the query engine level — impossible to bypass from SQL
- No setting = query fails entirely (fail-closed)
- Wrong project = 0 rows
- Unlimited concurrency (no session state)

**Test results:**
```
correct project, no WHERE in SQL → 592 rows (row policy filters automatically)
wrong project UUID               → 0 rows
no setting provided              → query FAILS (fail-closed)
SELECT * LIMIT 5 (no WHERE)      → only that project's data
```

#### Required changes:

**1. New ClickHouse migration** (`infra/clickhouse/migrations/0002_sandboxed_user.sql`):
```sql
-- Sandboxed user for AI-generated and user-supplied queries.
-- Uses per-query custom setting SQL_project_id + row policies for project isolation.
-- Server must have custom_settings_prefixes = 'SQL_' (ClickHouse default).

CREATE USER IF NOT EXISTS ai_query IDENTIFIED WITH sha256_password BY '<generated>';

-- Resource limits + readonly=2 (allows setting changes but blocks writes)
ALTER USER ai_query SETTINGS
  readonly = 2,
  max_execution_time = 10,
  max_rows_to_read = 1000000,
  max_result_rows = 10000,
  max_memory_usage = 100000000;

-- Grant only SELECT on breadcrumb database (no system.* access)
GRANT SELECT ON breadcrumb.* TO ai_query;

-- Revoke access to internal tables
REVOKE SELECT ON breadcrumb.spans_to_rollups FROM ai_query;
REVOKE SELECT ON breadcrumb.schema_migrations FROM ai_query;

-- Row policies — enforce project isolation at DB level.
-- getSetting('SQL_project_id') reads the per-query setting passed via clickhouse_settings.
-- If the setting is not provided, the query FAILS (fail-closed).
-- If a wrong project UUID is provided, 0 rows are returned.
CREATE ROW POLICY IF NOT EXISTS project_filter_traces
  ON breadcrumb.traces
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO ai_query;

CREATE ROW POLICY IF NOT EXISTS project_filter_spans
  ON breadcrumb.spans
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO ai_query;

CREATE ROW POLICY IF NOT EXISTS project_filter_rollups
  ON breadcrumb.trace_rollups
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO ai_query;
```

**2. New env var**: `CLICKHOUSE_AI_QUERY_PASSWORD` (add to `env.ts` + `.env.example`)

**3. New sandboxed client** in `src/db/clickhouse.ts`:
```ts
export const sandboxedClickhouse = createClient({
  url: env.clickhouseUrl,
  username: "ai_query",
  password: env.clickhouseAiQueryPassword,
  database: env.clickhouseDb,
  max_open_connections: 20,
  request_timeout: 15_000,
});
```

**4. `sanitizeSql` + `runSandboxedQuery` helper** (new file `src/lib/sandboxed-query.ts`):
```ts
/**
 * Strip any SETTINGS clause from the SQL to prevent overriding SQL_project_id.
 * ClickHouse SETTINGS is always the last clause. Handles string literals correctly.
 */
function sanitizeSql(sql: string): string {
  const upper = sql.toUpperCase();
  let inSingle = false, inDouble = false, lastSettings = -1;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && upper.startsWith("SETTINGS", i)) {
      const before = i === 0 || /\s/.test(sql[i - 1]);
      const after = i + 8 >= sql.length || /\s/.test(sql[i + 8]);
      if (before && after) lastSettings = i;
    }
  }
  if (lastSettings === -1) return sql;
  return sql.slice(0, lastSettings).trim();
}

export async function runSandboxedQuery(projectId: string, sql: string) {
  return sandboxedClickhouse.query({
    query: sanitizeSql(sql),
    clickhouse_settings: { SQL_project_id: projectId },
    query_params: { projectId },  // backward compat for saved chart SQL
    format: "JSONEachRow",
  });
}
```

Three layers of defense:
- **Row policies** (DB-enforced) — impossible to bypass from SQL
- **readonly=2 + GRANT** (DB-enforced) — no writes, no system tables
- **`sanitizeSql()`** (app-enforced) — prevents SQL SETTINGS override

**Verified behavior** (all tested locally):
| Scenario | Result |
|----------|--------|
| Normal query, correct project | Returns filtered data |
| `SELECT *` with no WHERE | Row policy filters to project |
| Wrong project UUID | 0 rows |
| No setting provided | Query fails (fail-closed) |
| `SETTINGS SQL_project_id='evil'` in SQL | Stripped by sanitizer |
| `INSERT`/`CREATE`/`ALTER` | Blocked by GRANT |
| `system.query_log` / `system.processes` | Blocked by GRANT |
| Materialized view `spans_to_rollups` | Blocked by REVOKE |
| `sleep(5)` DoS | Blocked by max_execution_time |
| Concurrent queries, different projects | Isolated correctly |
| Backward-compat `{projectId: UUID}` param | Still works |

**5. Swap `readonlyClickhouse` → `runSandboxedQuery()`** in 4 places:
- `src/trpc/routes/traces.ts` — AI search clause execution (the `writeSearchQuery` result)
- `src/trpc/routes/explores.ts` — `requery` procedure
- `src/mcp/index.ts` — `run_query` tool
- `src/lib/chart-generator.ts` — `run_query` and `display_chart` tool execution

Note: The rest of `readonlyClickhouse` usage (built-in dashboard queries in traces.ts,
MCP tools with hardcoded SQL) stays on `readonlyClickhouse` since those queries are
written by us, not by users/AI.

**6. Add regex blocklist** as defense-in-depth on AI clause from `writeSearchQuery`:
```ts
if (/\b(UNION|INSERT|ALTER|DROP|TRUNCATE|SYSTEM|INTO|GRANT)\b/i.test(clause)) {
  // reject, fall back to text search
}
```


### C. Env validation at startup

Currently silently falls back to defaults (including hardcoded `betterAuthSecret`
and empty `encryptionKey`).

Question: Should dev mode allow the default secret and empty encryption key?
Or require them always?

**Your call:**
can be default values but need to be set in dev as well

### D. Rate limiting

No rate limiting on any endpoint. Better Auth has built-in rate limiting
(enabled by default in prod).

Options:
1. Just configure Better Auth rate limiting explicitly (auth endpoints only)
2. Also add Hono-level rate limiting for `/v1/*`, `/trpc/*`, `/mcp`
   (needs storage backend — memory or database)

**Your call:**
go ahead with proper rate limiting, with whatever changes it needs

### E. Structured logging

Everything is `console.log`. No log levels, no JSON output, no request context.

Options:
1. Add `pino` for structured JSON logging (touches many files)
2. Just reduce the verbose ingest logs and keep `console.log` for now

**Your call:**
pino is good

### F. Batcher retry on failure

ClickHouseBatcher silently drops data if a flush fails.

Options:
1. Re-add failed batch to buffer for one retry attempt
2. Write failed batches to a dead-letter file on disk
3. Just log and accept the risk

**Your call:**
do one retry

### G. Audit logging

No logging of security events (failed logins, key creation, role changes, etc.)

Options:
1. Add Better Auth `databaseHooks` for auth events + log all tRPC mutations
2. Just add Better Auth hooks for now, defer tRPC mutation logging

**Your call:**
add logging

### H. Large file splits (`traces.ts` 1133 lines, `mcp/index.ts` 749 lines)

Options:
1. Split now into smaller files
2. Defer to the full feature-based directory restructure (Section 10 of REVIEW.md)
   — splitting now means refactoring twice

**Your call:**
refactor with feature based and split with that

### I. Duplicated query patterns between tRPC and MCP

Same ROLLUPS joins, argMax dedup, row mapping logic duplicated.

Options:
1. Extract shared helpers now
2. Defer to the directory restructure (same concern as H)

**Your call:**
yes, restructure and split there

### J. `requery` should be a query not mutation

Currently a mutation, which prevents React Query caching on the client
(causes the StarredChartCard mutation-in-useEffect anti-pattern).

Changing it requires updating both server and web client.

Options:
1. Fix now (server + client change)
2. Defer

**Your call:**
fix it

---

## Skip / Accept Risk

These don't need fixes:

- No MFA — feature request, not a code fix
- No password policy — Better Auth default, low risk for internal tool
- Invitation tokens as UUIDs — 122 bits of entropy is sufficient
- `observationViews` composite key syntax — needs migration to fix
- `buildProjectCondition` dynamic param names — safe in practice
- `loopbackRate` expensive CTEs — scoped + timeout safety net
- `getAiModel` not cached — fast enough
- `buildMcpServer` per request — tool registration is cheap
- Cookie cache strategy — `compact` is fine
- Test coverage — important but separate effort
