# Server Code Review — services/server

Reviewed for code quality, performance, maintainability, and basic security/DB hygiene. Separate passes for deep security audit and DB-specific optimizations will follow.

~5,900 lines across 30 source files.

---

## 1. Code Organization & Architecture

### 1a. `traces.ts` is 1,133 lines — should be split
**File:** `src/trpc/routes/traces.ts`
Contains 15+ procedures, helper functions, filter builders, and ClickHouse query templates. The `buildTraceFilters()`, `ROLLUPS_SUBQUERY`, `toStr()`, and formatting logic should be extracted:
- `src/lib/clickhouse-queries.ts` — shared query fragments (ROLLUPS_SUBQUERY, buildTraceFilters, toStr)
- Individual procedures could be grouped (stats/metrics vs. list/get vs. metadata)

**Impact:** Maintainability.

### 1b. `mcp/index.ts` is 749 lines — should be split
**File:** `src/mcp/index.ts`
All MCP tools are defined in a single function. Each tool is 50-100 lines of query building + result mapping. Extract each tool into its own file or group by entity (trace tools, span tools, query tools).

**Impact:** Maintainability.

### 1c. Duplicated ClickHouse query patterns between tRPC and MCP
Both `traces.ts` and `mcp/index.ts` build similar dedup subqueries with `argMax(field, version)`, ROLLUPS joins, and row mapping. These should share helpers from a common module.

**Impact:** DRY, bug risk when one is updated but not the other.

### 1d. Duplicated row-mapping logic
`mcp/index.ts` maps ClickHouse rows to camelCase objects in 4+ tools with nearly identical code. Extract a `mapTraceRow()` and `mapSpanRow()` helper.

**Impact:** Maintainability, consistency.

---

## 2. Performance

### 2a. Session middleware runs on EVERY request including `/v1/*` ingest
**File:** `src/index.ts:38-45`
```ts
app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  ...
});
```
The `*` wildcard means every `/v1/traces` and `/v1/spans` ingest request hits the session middleware (Better Auth cookie lookup + potential DB query), even though these endpoints use API key auth, not sessions. This is wasted work on the hot path.

**Fix:** Scope the session middleware to only `/trpc/*` and `/api/auth/*` routes, or use a path check to skip `/v1/*` and `/mcp` routes.

**Impact:** HIGH for ingest throughput. Every trace/span POST pays a session lookup cost.

### 2b. `getObservationsForProject` called on every trace.end()
**File:** `src/ingest/index.ts:122`
The observation cache has a 60s TTL, but `scheduleObservationJobs` still does async work (cache lookup + filtering + job enqueue) on every trace completion. For high-throughput ingest this could become a bottleneck.

**Impact:** Low-Medium. The 60s cache mitigates most DB hits, but the async scheduling work is still per-trace.

### 2c. `getUserProjectIds` in MCP makes 1-2 DB queries per tool call
**File:** `src/mcp/index.ts:19-37`
Every MCP tool call that doesn't provide `project_id` queries the user table + member table. With multiple sequential tool calls in a conversation, this is repeated. Consider caching per MCP session.

**Impact:** Low-Medium.

### 2d. No connection pooling config for Postgres
**File:** `src/db/index.ts`
The Drizzle setup uses `postgres()` from `postgres` package with default connection settings. For production with pg-boss + multiple concurrent requests, explicit pool sizing would help. Currently relies on the postgres.js library defaults.

**Impact:** Low (postgres.js defaults are reasonable, but should be made explicit for production).

### 2e. ClickHouseBatcher doesn't retry on failure
**File:** `src/db/clickhouse-batcher.ts:36-38`
```ts
} catch (err) {
  console.error(`[batcher] failed to flush...`, err);
}
```
If a batch fails, the data is lost. No retry, no dead-letter queue, no re-buffering.

**Impact:** Medium. In production, a transient ClickHouse hiccup could silently drop traces/spans.

---

## 3. Error Handling & Reliability

### 3a. `ingestRoutes.post("/traces")` swallows JSON parse errors
**File:** `src/ingest/index.ts:31`
```ts
const body = await c.req.json().catch(() => null);
```
If the body is not valid JSON, it becomes `null`, which then fails Zod validation with a generic error. The caller gets a 400 but no indication that the JSON itself was malformed (vs. missing required fields).

**Impact:** Low. DX issue for SDK developers debugging ingestion.

### 3b. Observation job errors are not surfaced to users
**File:** `src/jobs/evaluate-observation.ts`
If the AI model call fails or returns nonsensical results, it's only logged to console. There's no way for users to see that their observation evaluation failed.

**Impact:** Low-Medium. Users may wonder why no findings are appearing.

### 3c. `explores.requery` exposes raw ClickHouse errors
**File:** `src/trpc/routes/explores.ts:224-231`
```ts
requery: orgViewerProcedure
  .input(z.object({ projectId: z.string(), sql: z.string() }))
  .mutation(async ({ input }) => {
    const result = await readonlyClickhouse.query({ query: input.sql, ... });
    return (await result.json()) as Record<string, unknown>[];
  }),
```
No try/catch — ClickHouse SQL errors propagate as unhandled exceptions to the client. Should wrap in try/catch and return a user-friendly error.

**Impact:** Medium. Bad UX and potentially leaks internal error details.

### 3d. Generation manager cleanup timeout creates memory leak risk
**File:** `src/lib/generation-manager.ts:42-46`
```ts
setTimeout(() => {
  if (active.get(exploreId) === gen) {
    active.delete(exploreId);
  }
}, 60_000);
```
If a generation errors immediately but the timeout keeps a reference for 60s, and many generations are started rapidly, the `active` map grows. The 60s delay is reasonable but there's no upper bound on concurrent generations.

**Impact:** Low. Would only matter under heavy concurrent explore usage.

---

## 4. Type Safety & Validation

### 4a. Hono context uses `any` casts for user/session
**File:** `src/index.ts:41-43`
```ts
(c as any).set("user", session?.user ?? null);
(c as any).set("session", session?.session ?? null);
```
And in the MCP handler:
```ts
const userId = (c as any).get("userId") as string;
```
Hono supports typed context variables. Define a proper `Variables` type and use `Hono<{ Variables: ... }>` to eliminate the casts.

**Impact:** Low. Type safety improvement.

### 4b. ClickHouse query results are untyped `Record<string, unknown>[]`
Throughout `traces.ts` and `mcp/index.ts`, ClickHouse results are cast with `as Array<Record<string, unknown>>` and then accessed with `String(r["field"])` / `Number(r["field"])`. No runtime validation.

**Impact:** Low. ClickHouse returns deterministic shapes for fixed queries, but a schema change could silently break mappings.

### 4c. `explores.messages` is `jsonb` with no schema validation on read
**File:** `src/trpc/routes/explores.ts:253`
```ts
const existingParts = (explore?.messages ?? []) as DisplayPart[];
```
The JSONB column is cast without validation. If the data is corrupted or the schema evolves, this could crash the generation.

**Impact:** Low.

---

## 5. Logging & Observability

### 5a. Excessive console.log in ingest hot path
**File:** `src/ingest/index.ts:121-143`
```ts
console.log(`[obs] trace.end received — project=${projectId} trace=${traceId}...`);
console.log(`[obs] ${obs.length} enabled observation(s) for project`);
console.log(`[obs] ${matching.length} observation(s) match trace name`);
// ... per-observation log
```
4+ log lines per trace.end(), plus per-observation logs. At high throughput this floods stdout.

**Impact:** Medium in production. Should use a log level system or remove verbose ingest logging.

### 5b. Batcher logs every flush
**File:** `src/db/clickhouse-batcher.ts:35`
```ts
console.log(`[batcher] flushed ${batch.length} rows to ${this.table}`);
```
Every 1s flush logs. At steady state this is 2 log lines per second (traces + spans).

**Impact:** Low. Noisy but not harmful.

---

## 6. Code Quality

### 6a. `env.ts` doesn't validate at startup
**File:** `src/env.ts`
```ts
export const env = {
  databaseUrl: process.env.DATABASE_URL || "postgres://...",
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  ...
};
```
Missing env vars silently fall back to defaults or empty strings. `encryptionKey` is empty by default — the app will crash on first encrypt/decrypt call instead of at startup. Should validate with Zod and fail fast.

**Impact:** Medium. Hard-to-debug production failures.

### 6b. `clickhouse.ts` migration has SQL injection risk
**File:** `src/db/clickhouse.ts:126`
```ts
await adminClient.command({
  query: `CREATE DATABASE IF NOT EXISTS ${env.clickhouseDb}`,
});
```
And line 172:
```ts
await clickhouse.command({
  query: `INSERT INTO breadcrumb.schema_migrations (version, name) VALUES (${version}, '${file}')`,
});
```
The database name and migration file name are interpolated directly into SQL. While these come from env vars and filesystem (not user input), it's still poor practice. Use parameterized queries where possible.

**Impact:** Low (controlled inputs), but flagging for the security pass.

### 6c. `buildProjectCondition` in MCP builds dynamic param names
**File:** `src/mcp/index.ts:43-57`
```ts
const placeholders = projectIds.map((id, i) => {
  params[`p${i}`] = id;
  return `{p${i}: UUID}`;
});
```
This is safe since the values are UUIDs from the database, but the dynamic param naming is fragile.

**Impact:** Low.

### 6d. Verbose `console.log` in production code
**Files:** Throughout `evaluate-observation.ts`, `ingest/index.ts`, `clickhouse.ts`, `clickhouse-batcher.ts`
The codebase uses `console.log` / `console.error` everywhere with no log levels. Should use a structured logger (e.g., `pino`) to support log levels, JSON output for production, and request context.

**Impact:** Medium for production operations.

---

## 7. API Design

### 7a. `explores.requery` is a mutation but should be a query
**File:** `src/trpc/routes/explores.ts:222-231`
This endpoint just runs a SELECT query and returns results. It's defined as a mutation because tRPC queries can't accept arbitrary SQL bodies easily, but semantically it's a read operation. This prevents React Query caching on the client (which was flagged in the web review).

**Impact:** Low-Medium. Causes the StarredChartCard mutation-in-useEffect anti-pattern on the client.

### 7b. `explores.get` uses `procedure` (public) with manual auth check
**File:** `src/trpc/routes/explores.ts:39-57`
Instead of using `orgViewerProcedure`, this procedure manually checks auth. The pattern is inconsistent with the rest of the codebase.

**Impact:** Low. Works correctly but inconsistent.

### 7c. Inconsistent use of dot-notation for nested procedures
**File:** `src/trpc/routes/observations.ts`
Some procedures use dot notation (`"findings.listAll"`, `"findings.dismiss"`). While tRPC supports this, it makes the client API awkward: `trpc.observations["findings.listAll"].useQuery()`. Consider using a nested router instead.

**Impact:** Low. Cosmetic/DX issue.

---

## 8. Testing

### 8a. Test coverage is minimal
Only 6 test files covering basic auth, ingest helpers, and route validation. No tests for:
- tRPC procedures (traces, explores, observations)
- ClickHouse query correctness
- MCP tools
- AI generation flow
- Cache behavior
- Encryption round-trip

**Impact:** Medium-High. Major features are untested.

---

---

## 9. Detailed Second Pass — Additional Findings

### 9a. `checkSignupAllowed` queries the user table twice during first signup
**File:** `src/auth/signup-guard.ts:12-17` and `src/auth/better-auth.ts:46-50`
During the first user's signup, `checkSignupAllowed` does `SELECT id FROM user LIMIT 1` to check if it's the first user. Then the `databaseHooks.user.create.before` hook does the exact same query. Two identical queries in sequence during the same signup flow.

**Fix:** Move the "first user" check to one location only.

**Impact:** Low. Only affects the very first signup.

### 9b. `toMicroDollars` treats `0` as falsy
**File:** `src/ingest/helpers.ts:10`
```ts
export function toMicroDollars(usd: number | undefined): number {
  if (!usd) return 0;
```
`!usd` is true when `usd === 0`, which happens to be correct here (0 * 1M = 0), but the intent is to check for `undefined`. Should be `if (usd == null) return 0;` for clarity.

**Impact:** None (functionally correct but misleading).

### 9c. `projects.create` generates slug from name but doesn't guarantee uniqueness
**File:** `src/trpc/routes/projects.ts:66-76`
```ts
const slug = input.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
```
The slug column has a unique constraint, but two projects named "My App" would collide. The fallback `slug || crypto.randomUUID()` only triggers if the slug is empty after sanitization, not on collision.

**Impact:** Low. Would cause a DB error on name collision — not a data issue but a bad UX.

### 9d. `projects.delete` runs ClickHouse DELETE mutations in parallel with Postgres delete
**File:** `src/trpc/routes/projects.ts:107-124`
```ts
await Promise.all([
  db.delete(organization).where(...),
  clickhouse.command({ query: "ALTER TABLE breadcrumb.traces DELETE ..." }),
  clickhouse.command({ query: "ALTER TABLE breadcrumb.spans DELETE ..." }),
  clickhouse.command({ query: "ALTER TABLE breadcrumb.trace_rollups DELETE ..." }),
]);
```
If the Postgres delete succeeds but a ClickHouse delete fails, the org is gone but orphaned trace data remains in ClickHouse. Should delete ClickHouse data first, then Postgres (or handle partial failures).

Also: ClickHouse `ALTER TABLE DELETE` is async (returns immediately, mutation runs in background). The `Promise.all` resolves before data is actually deleted.

**Impact:** Low. Only affects project deletion, which is rare.

### 9e. `invitations.create` doesn't filter expired invitations when checking for duplicates
**File:** `src/trpc/routes/invitations.ts:49-58`
The duplicate check only looks for `status: "pending"` but doesn't filter `expiresAt > now()`. An expired-but-pending invitation would block creating a new one.

**Impact:** Low. Edge case.

### 9f. API key cache is never bounded
**File:** `src/auth/index.ts:10`
```ts
const keyCache = new Map<string, { projectId: string; expiresAt: number }>();
```
Entries are added on each new API key lookup and only removed on cache miss (invalid key). If there are many rotated keys, the map grows unbounded. Should periodically prune expired entries or use a bounded LRU cache.

Same for `mcpKeyCache`.

**Impact:** Low. Would only matter with many key rotations over a long uptime.

### 9g. `buildMcpServer` creates a new server instance per request
**File:** `src/index.ts:55-59`
```ts
app.all("/mcp", requireMcpKey, async (c) => {
  const mcpServer = buildMcpServer(userId);
  const transport = new StreamableHTTPTransport();
  await mcpServer.connect(transport);
  return transport.handleRequest(c as any);
});
```
Every MCP request instantiates a new `McpServer`, registers all tools, creates a transport, and connects. For stateless HTTP this is fine, but it's worth noting for performance — the tool registration overhead is paid on every request.

**Impact:** Low. Tool registration is just function calls, not expensive.

### 9h. No rate limiting on any endpoint
No rate limiting on `/v1/*` ingest, `/trpc/*` API, `/mcp` endpoint, or `/api/auth/*` (login/signup). A malicious client could:
- Flood ingest with junk traces
- Brute-force login credentials
- Exhaust AI provider API quotas via explore chat

**Impact:** Medium for production. Flagged for security pass.

### 9i. `aiProviders.upsert` writes empty string for encryptedApiKey on conflict
**File:** `src/trpc/routes/aiProviders.ts:69`
```ts
encryptedApiKey: keyFields.encryptedApiKey ?? "",
```
When creating a new provider without an API key (which is blocked by the check on line 53-55), this would write an empty string to the encrypted key column. The `""` default in the `.values()` object could theoretically be reached if the validation is bypassed.

**Impact:** None (dead code path due to validation), but the empty string default is confusing.

### 9j. `explore.chat` subscription doesn't validate that the explore belongs to the project
**File:** `src/trpc/routes/explores.ts:192-218`
The input has both `exploreId` and `projectId`, but the subscription only uses `exploreId` for the generation manager. It doesn't verify that the explore record actually belongs to the given project. The `orgMemberProcedure` middleware checks project membership, but a user could pass a valid `projectId` they have access to along with an `exploreId` from a different project.

**Impact:** Medium. Potential cross-project data leakage via explore conversations.

### 9k. `observations.queueStats` queries pg-boss internal tables directly
**File:** `src/trpc/routes/observations.ts:256-282`
```ts
await db.execute<{ state: string; count: string }>(sql`
  SELECT state, COUNT(*)::text AS count
  FROM pgboss.job
  WHERE name = 'evaluate-observation'
  ...
`);
```
Querying pg-boss internal tables directly couples the code to pg-boss's schema. If pg-boss changes its internal table structure in an update, this breaks silently. pg-boss provides a `.getQueueSize()` API that should be used instead.

**Impact:** Low.

### 9l. `getAiModel` doesn't cache the decrypted key
**File:** `src/lib/ai-provider.ts:20-36`
Every call to `getAiModel` hits the database and runs AES-256-GCM decryption. In the explore chat flow, this is called once per generation (acceptable). But in the observation worker, it's called per-job. With `CONCURRENCY=5`, that's 5 concurrent decrypt + DB lookups.

**Impact:** Low. Decrypt is fast and DB lookup is simple.

---

## 10. Proposed Feature-Based Directory Structure

The current structure groups by technical layer (auth/, db/, trpc/, lib/, etc.). For a codebase of this size, a **feature-based** approach with shared infrastructure would be more maintainable:

```
src/
  app.ts                    ← Hono app setup, middleware, route mounting
  index.ts                  ← Entry point (startup, migrations, shutdown)
  env.ts                    ← Validated env config

  shared/                   ← Cross-cutting infrastructure
    db/
      postgres.ts           ← Drizzle client + migrations
      schema.ts             ← All Postgres tables (or split by feature)
      clickhouse.ts         ← ClickHouse clients + migrations
      clickhouse-batcher.ts
    auth/
      better-auth.ts
      signup-guard.ts
      api-key-middleware.ts ← requireApiKey
      mcp-key-middleware.ts ← requireMcpKey
    lib/
      encryption.ts
      api-keys.ts
      cache.ts
      ai-provider.ts
      clickhouse-schema.ts ← shared CH schema description for AI

  features/
    ingest/
      routes.ts             ← POST /v1/traces, /v1/spans
      schemas.ts            ← Zod schemas
      helpers.ts
      observations-scheduler.ts ← scheduleObservationJobs

    traces/
      router.ts             ← tRPC traces router
      stats.ts              ← stats, dailyMetrics, qualityTimeline
      list.ts               ← list, get, spans
      metadata.ts           ← environments, models, names
      helpers.ts            ← buildTraceFilters, ROLLUPS_SUBQUERY, toStr, row mappers

    projects/
      router.ts             ← tRPC projects, apiKeys, mcpKeys, members, invitations

    explore/
      router.ts             ← tRPC explores router
      generation-manager.ts
      chart-generator.ts
      query-writer.ts
      types.ts

    observations/
      router.ts             ← tRPC observations router
      evaluate-job.ts       ← pg-boss worker
      cache.ts              ← observations-cache

    mcp/
      server.ts             ← MCP server factory
      tools/
        traces.ts           ← list_traces, get_trace, find_outliers
        spans.ts            ← get_span, list_spans
        query.ts            ← run_query, introspect_schema
        observations.ts     ← get_observations, search/create/update findings
      helpers.ts

    config/
      router.ts             ← tRPC config router

  cron.ts
  trpc.ts                   ← tRPC init, context, procedures
```

**Benefits:**
- Each feature is self-contained — router + business logic + types together
- Shared query helpers live in `features/traces/helpers.ts` and are imported by both tRPC and MCP
- MCP tools split into per-entity files (~100-150 lines each instead of 749)
- traces router split into 3 focused files instead of one 1133-line monster
- Easy to find "everything related to observations" in one folder

**Impact:** Large refactor, but significantly improves navigability and reduces merge conflicts.

---

## Updated Summary by Priority

| Priority | Issue | Impact |
|----------|-------|--------|
| **HIGH** | 2a. Session middleware on ingest hot path | Performance |
| **HIGH** | 6a. No env validation at startup | Reliability |
| **MEDIUM** | 9j. explore.chat doesn't verify explore belongs to project | Security |
| **MEDIUM** | 9h. No rate limiting on any endpoint | Security |
| **MEDIUM** | 2e. Batcher drops data on flush failure | Data loss |
| **MEDIUM** | 3c. requery exposes raw ClickHouse errors | UX/Security |
| **MEDIUM** | 5a. Excessive logging on ingest path | Production ops |
| **MEDIUM** | 1a-d. Large files + duplicated query patterns | Maintainability |
| **MEDIUM** | 6d. No structured logging | Production ops |
| **MEDIUM** | 10. Feature-based directory restructure | Maintainability |
| **LOW** | 9d. Project delete race between PG and CH | Correctness |
| **LOW** | 9f. Unbounded API key cache | Memory |
| **LOW** | 4a. Hono context uses `any` casts | Type safety |
| **LOW** | 7a-c. API design inconsistencies | Consistency |
| **LOW** | 9b/9c/9e/9k. Minor edge cases | Various |

## Updated Top Recommendations

1. **Skip session middleware for `/v1/*` and `/mcp`** — Biggest perf win.
2. **Validate env vars at startup with Zod** — Fail fast.
3. **Verify explore belongs to project in chat subscription** — Security fix.
4. **Add retry to ClickHouseBatcher** — Prevent data loss.
5. **Wrap `requery` in try/catch** — Don't leak ClickHouse errors.
6. **Reduce ingest logging** — Remove or gate verbose logs.
7. **Restructure to feature-based directories** — Better maintainability (see Section 10).
8. **Type Hono context variables** — Eliminate `as any` casts.

| Priority | Issue | Impact |
|----------|-------|--------|
| **HIGH** | 2a. Session middleware on ingest hot path | Performance |
| **HIGH** | 6a. No env validation at startup | Reliability |
| **MEDIUM** | 2e. Batcher drops data on flush failure | Data loss |
| **MEDIUM** | 3c. requery exposes raw ClickHouse errors | UX/Security |
| **MEDIUM** | 5a. Excessive logging on ingest path | Production ops |
| **MEDIUM** | 1a. traces.ts is 1133 lines | Maintainability |
| **MEDIUM** | 1b. mcp/index.ts is 749 lines | Maintainability |
| **MEDIUM** | 1c/1d. Duplicated query patterns & row mapping | DRY |
| **MEDIUM** | 6d. No structured logging | Production ops |
| **LOW** | 4a. Hono context uses `any` casts | Type safety |
| **LOW** | 7a. requery should be a query not mutation | API design |
| **LOW** | 7b/7c. Inconsistent auth & naming patterns | Consistency |
| **LOW** | 3a. Swallowed JSON parse errors | DX |
| **LOW** | 6b. SQL interpolation in migrations | Security (flagged) |

## Top Recommendations (ordered by impact)

1. **Skip session middleware for `/v1/*` and `/mcp`** — These use their own auth (API key / MCP key). Skipping Better Auth session lookup on every ingest request is the single biggest performance win.
2. **Validate env vars at startup with Zod** — Fail fast on missing `ENCRYPTION_KEY`, `DATABASE_URL`, etc.
3. **Add retry/re-buffer to ClickHouseBatcher** — On flush failure, re-add the batch to the buffer for a retry attempt.
4. **Wrap `requery` in try/catch** — Return structured errors instead of leaking ClickHouse internals.
5. **Reduce ingest logging** — Remove per-trace console.log calls, or gate behind a debug flag.
6. **Split `traces.ts` and `mcp/index.ts`** — Extract shared query helpers and break up the large files.
7. **Type Hono context variables** — Eliminate `as any` casts with proper Variables type.
