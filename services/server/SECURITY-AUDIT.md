# Security, Auth & SQL Audit — services/server

Comprehensive review covering OWASP Top 10, Better Auth configuration, SQL injection surfaces, access control, and data protection.

---

## OWASP A01: Broken Access Control

### CRITICAL: All `traces.*` tRPC endpoints have ZERO authentication

**Files:** `src/trpc/routes/traces.ts` — all 16 procedures
All use bare `procedure` (no auth). Any HTTP client can read any project's trace data by providing a valid project UUID. This includes:
- Full trace content (inputs, outputs, model names, prompts)
- Cost and token data
- Environment names, user IDs
- Span details with LLM prompt/response content

The web client masks this with a client-side redirect, but direct `POST /trpc/traces.list` calls bypass it completely.

**Fix:** Change all to `orgViewerProcedure`.

### HIGH: AI-generated SQL injected directly into ClickHouse query

**File:** `src/trpc/routes/traces.ts:279-281`
```ts
if (aiResult.clause) {
  clauses.push(aiResult.clause);  // RAW AI OUTPUT → SQL
}
```
The AI model's response from `writeSearchQuery()` is pushed directly into the ClickHouse WHERE clause as a raw string. The AI prompt says "output ONLY the raw SQL condition" — but a prompt injection via the user's search query could manipulate the AI into generating malicious SQL.

While `readonlyClickhouse` has `readonly=1` (prevents INSERT/DELETE/DDL), a crafted clause could:
- Read data from other projects: `1=1 OR project_id != '{projectId}'`
- Exfiltrate data via timing side-channels
- Cause DoS via expensive queries: `1=1 AND sleep(10)`

The AI output is also **cached for 1 hour** (`cache.set("qw", ...)`), so a single successful injection persists.

**Fix:** Run the AI-generated clause through a SQL parser/validator that rejects:
- Subqueries referencing other project_ids
- Function calls like `sleep()`, `system()`
- UNION/JOIN additions
- Any clause not matching a simple predicate pattern

Or: run the AI query in a sandboxed ClickHouse user with row-level security.

### HIGH: `explores.chat` doesn't verify explore belongs to project

**File:** `src/trpc/routes/explores.ts:192-218`
Already documented in AUTH-AUDIT.md. User A with access to project A can read project B's explore conversations by passing `projectId: "A", exploreId: "<B's explore>"`.

### MEDIUM: `run_query` (MCP) and `requery` (tRPC) allow cross-project reads

Both accept user-supplied SQL. The `{projectId: UUID}` param is **available** but not enforced in the query text. A query like `SELECT * FROM breadcrumb.spans LIMIT 100` returns data from all projects.

### MEDIUM: `requery` has no try/catch — leaks ClickHouse error details

**File:** `src/trpc/routes/explores.ts:224-231`
Raw ClickHouse error messages (including table names, column types, internal state) propagate to the client.

---

## OWASP A02: Cryptographic Failures

### MEDIUM: `betterAuthSecret` defaults to a weak dev secret

**File:** `src/env.ts:4`
```ts
betterAuthSecret: process.env.BETTER_AUTH_SECRET || "dev-secret-change-in-production",
```
If `BETTER_AUTH_SECRET` is not set, the app runs with a static, publicly-known secret. This is fine for local dev but catastrophic in production — sessions can be forged. There's no runtime check preventing this.

**Fix:** Fail at startup in production if secret is the default or too short.

### MEDIUM: `encryptionKey` defaults to empty string

**File:** `src/env.ts:15`
```ts
encryptionKey: process.env.ENCRYPTION_KEY || "",
```
An empty encryption key means `getKey()` in `encryption.ts` throws on first use, but the error message doesn't mention the env var by name. App starts successfully then crashes when an AI provider key is first encrypted/decrypted.

**Fix:** Validate at startup. Require 64-char hex.

### LOW: AES-256-GCM implementation is correct

**File:** `src/lib/encryption.ts`
Uses `aes-256-gcm` with random 12-byte IV and auth tag. Format `iv:ciphertext:authTag` is standard. No issues found.

### LOW: API key hashing uses SHA-256 (no salt)

**File:** `src/lib/api-keys.ts:11`
```ts
return createHash("sha256").update(key).digest("hex");
```
API keys are 48 random hex bytes (192 bits of entropy), so rainbow tables are impractical. SHA-256 without salt is acceptable for high-entropy tokens. This would NOT be acceptable for passwords — but Better Auth handles passwords separately.

---

## OWASP A03: Injection

### CRITICAL: AI-generated SQL clause injected without sanitization

(Detailed above in A01 section.)

### MEDIUM: ClickHouse migration uses string interpolation for SQL

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
The database name and file name come from env vars / filesystem (not user input), but this is still a SQL injection surface. A malicious `CLICKHOUSE_DB` env var or a migration filename containing `'` would break the query.

**Fix:** Use parameterized queries for the INSERT. The CREATE DATABASE is harder to parameterize but should at minimum validate `env.clickhouseDb` against `^[a-z][a-z0-9_]*$`.

### MEDIUM: `search_findings` tool in observation evaluator uses unescaped ILIKE

**File:** `src/jobs/evaluate-observation.ts:169-173`
```ts
const conditions = keywords.map((kw) =>
  or(
    ilike(observationFindings.title, `%${kw}%`),
    ilike(observationFindings.description, `%${kw}%`),
  ),
);
```
The `keywords` come from the AI model's tool call. If the AI is manipulated, it could pass `%` or `_` wildcards as keywords. Drizzle's `ilike()` uses parameterized queries internally so there's no SQL injection, but LIKE wildcards (`%`, `_`) in the search term could cause unexpected matches.

**Impact:** Low — this is internal AI-to-DB communication, not user input.

### OK: All ClickHouse queries use parameterized syntax

All queries in `traces.ts` and `mcp/index.ts` use ClickHouse's `{param: Type}` named parameter syntax. No string concatenation of user input into queries (except the AI clause issue above).

### OK: All Drizzle/Postgres queries use the ORM's query builder

No raw SQL with string concatenation against Postgres. Drizzle handles parameterization.

---

## OWASP A04: Insecure Design

### MEDIUM: No rate limiting anywhere

**Files:** `src/index.ts`, `src/auth/better-auth.ts`

No rate limiting on:
- **`/api/auth/sign-in/email`** — brute-force login attempts
- **`/api/auth/sign-up/email`** — account creation spam
- **`/v1/traces`, `/v1/spans`** — ingest flooding
- **`/trpc/explores.chat`** — AI API quota exhaustion
- **`/mcp` tools** — query flooding

Better Auth has built-in rate limiting (enabled by default in production), but the current config doesn't configure it explicitly. The default is 100 requests per 10 seconds — which is too lenient for auth endpoints.

**Fix:** Configure Better Auth rate limiting explicitly:
```ts
rateLimit: {
  enabled: true,
  storage: "database",
  customRules: {
    "/api/auth/sign-in/email": { window: 60, max: 5 },
    "/api/auth/sign-up/email": { window: 60, max: 3 },
  },
},
```
Add Hono rate limiting middleware for `/v1/*`, `/trpc/*`, and `/mcp`.

### MEDIUM: Invitation tokens are predictable UUIDs

**File:** `src/trpc/routes/invitations.ts:66`
```ts
const id = crypto.randomUUID();
```
The invitation ID (used as the `token` in the accept-invite URL) is a UUIDv4. While UUIDv4 has 122 bits of randomness (enough), it's used directly as a bearer token in a URL:
```
/accept-invite?token=<uuid>
```
This is acceptable but note that:
- URLs are logged in server access logs, browser history, analytics
- The token is valid for 7 days with no single-use enforcement
- After accepting, the invitation stays in the DB with status changed

**Recommendation:** Consider using a cryptographically random token instead of UUID. Mark invitations as consumed after acceptance.

### LOW: No password policy beyond min length

Better Auth's `emailAndPassword: { enabled: true }` doesn't configure password requirements. The signup form on the web client has `minLength={8}` but there's no server-side enforcement of complexity, common password blocklist, or breach database check.

---

## OWASP A05: Security Misconfiguration

### HIGH: Session middleware runs on ingest hot path

(Already documented in REVIEW.md as performance issue — also a security concern because it leaks session handling overhead to unauthenticated endpoints.)

### MEDIUM: `trustedOrigins` includes hardcoded localhost

**File:** `src/auth/better-auth.ts:12`
```ts
trustedOrigins: [env.appBaseUrl, "http://localhost:3000", "http://localhost:5173"],
```
In production, `http://localhost:3000` and `http://localhost:5173` should not be trusted origins. An attacker on the same machine (or with DNS rebinding) could exploit this.

**Fix:** Only include localhost origins in development:
```ts
trustedOrigins: [
  env.appBaseUrl,
  ...(env.nodeEnv === "development" ? ["http://localhost:3000", "http://localhost:5173"] : []),
],
```

### MEDIUM: No security headers (Helmet equivalent)

The Hono app doesn't set security headers:
- No `Content-Security-Policy`
- No `X-Content-Type-Options: nosniff`
- No `X-Frame-Options: DENY`
- No `Strict-Transport-Security`
- No `Referrer-Policy`

In production, the SPA is served from this same server (`serveStatic`), so these headers matter.

**Fix:** Add `hono/secure-headers` middleware:
```ts
import { secureHeaders } from "hono/secure-headers";
app.use("*", secureHeaders());
```

### LOW: CORS allows all methods including DELETE

**File:** `src/index.ts:22`
```ts
allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
```
tRPC only uses POST. The ingest API only uses POST. DELETE is not needed for any endpoint. Restricting to `["GET", "POST", "OPTIONS"]` reduces the attack surface.

---

## OWASP A07: Identification and Authentication Failures

### MEDIUM: Better Auth cookie cache uses `compact` strategy by default

**File:** `src/auth/better-auth.ts:18-21`
```ts
session: {
  cookieCache: {
    enabled: true,
    maxAge: 5 * 60,
  },
},
```
No `strategy` is specified. The default `compact` strategy stores session data as Base64url + HMAC in the cookie. This means session data (user ID, email, role) is visible (though not tamperable) to the client.

**Recommendation:** Consider using `strategy: "jwe"` for encrypted session cookies, or keep `compact` if session data isn't sensitive.

### LOW: No session `expiresIn` or `updateAge` configured

Better Auth defaults: sessions expire in 7 days, refresh every 24 hours. These are reasonable. Explicitly setting them is best practice.

### LOW: No MFA support

Single-factor auth only (email + password). Better Auth supports TOTP and other MFA plugins.

---

## OWASP A09: Security Logging and Monitoring Failures

### MEDIUM: No audit logging for security events

No logging of:
- Failed login attempts
- API key creation/deletion
- AI provider key changes (encryption key rotation)
- Member role changes
- Project deletion
- MCP key usage

Only `console.log` is used, with no structured format, no request IDs, and no security event categorization.

**Fix:** Add `databaseHooks` to Better Auth for auth events. Add structured logging (pino) for all mutation operations.

### MEDIUM: Ingest endpoint has no abuse detection

No monitoring for:
- Unusually high trace/span volume from a single API key
- Malformed or junk data patterns
- API keys making requests after deletion (stale cache)

---

## Better Auth Configuration Audit

| Setting | Current | Recommended | Status |
|---------|---------|-------------|--------|
| `secret` | Falls back to hardcoded dev value | Require via env, fail at startup | **NEEDS FIX** |
| `baseURL` | From env | OK | OK |
| `trustedOrigins` | Includes localhost in all envs | Conditional on NODE_ENV | **NEEDS FIX** |
| `emailAndPassword` | `{ enabled: true }` | Add password policy | LOW |
| `session.cookieCache` | `{ enabled: true, maxAge: 300 }` | Add `strategy: "jwe"` for sensitive data | LOW |
| `session.expiresIn` | Default (7 days) | Explicitly configure | LOW |
| `session.updateAge` | Default (24 hours) | Explicitly configure | LOW |
| `rateLimit` | Not configured (default: enabled in prod) | Explicitly configure with custom rules | **NEEDS FIX** |
| `advanced.useSecureCookies` | Default (auto in production) | Explicitly set `true` | LOW |
| `advanced.disableCSRFCheck` | Default (`false`) | OK | OK |
| `databaseHooks` | Only user.create.before | Add session + account hooks for audit | RECOMMENDED |
| `account.encryptOAuthTokens` | Not set (no OAuth) | N/A | OK |

---

## SQL & Query Security Summary

### ClickHouse Queries

| Pattern | Used In | Parameterized? | Issue |
|---------|---------|----------------|-------|
| Project ID filter | All queries | YES — `{projectId: UUID}` | OK |
| Date range filter | traces.ts | YES — `{from: Date}`, `{to: Date}` | OK |
| Array filters (names, envs, models) | traces.ts | YES — `{names: Array(String)}` | OK |
| LIKE search | traces.ts (fallback), mcp/index.ts | YES — `{searchText: String}` | OK (LIKE wildcards not escaped, low risk) |
| AI-generated clause | traces.ts:280 | **NO — raw string** | **CRITICAL** |
| User-supplied SQL | explores.requery, mcp run_query | **NO — raw SQL** | **MEDIUM** (readonly=1 mitigates writes) |
| Migration INSERT | clickhouse.ts:172 | **NO — string interpolation** | **LOW** (controlled input) |
| CREATE DATABASE | clickhouse.ts:126 | **NO — string interpolation** | **LOW** (env var input) |

### Postgres Queries

| Pattern | Used In | Safe? |
|---------|---------|-------|
| All Drizzle ORM queries | Every tRPC route | YES — parameterized by ORM |
| `ilike()` with search terms | evaluate-observation.ts | YES — parameterized, but wildcards not escaped |
| `db.execute(sql\`...\`)` | observations.ts (queueStats) | YES — Drizzle template literal parameterization |
| pg-boss job data | ingest/index.ts | YES — JSON serialized via pg-boss API |

---

## Critical Findings — Action Required

| # | Severity | Finding | OWASP |
|---|----------|---------|-------|
| 1 | **CRITICAL** | All 16 `traces.*` endpoints have zero authentication | A01 |
| 2 | **CRITICAL** | AI-generated SQL clause injected raw into ClickHouse query | A03 |
| 3 | **HIGH** | `explores.chat` cross-project data leakage | A01 |
| 4 | **HIGH** | `betterAuthSecret` defaults to public dev value | A02 |
| 5 | **MEDIUM** | No rate limiting configured (login brute-force, API flooding) | A04 |
| 6 | **MEDIUM** | `trustedOrigins` includes localhost in production | A05 |
| 7 | **MEDIUM** | No security headers (CSP, HSTS, X-Frame-Options) | A05 |
| 8 | **MEDIUM** | `run_query`/`requery` allow cross-project reads | A01 |
| 9 | **MEDIUM** | No audit logging for security events | A09 |
| 10 | **MEDIUM** | `encryptionKey` not validated at startup | A02 |
| 11 | **MEDIUM** | `requery` leaks raw ClickHouse error details | A01 |

---

## Final Pass — Additional Findings

### 12a. Auth route registered BEFORE CORS middleware

**File:** `src/index.ts:26-33`
```ts
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));  // line 26

app.use("/trpc/*", corsConfig);  // line 29
app.use("/api/*", corsConfig);   // line 31
```
The auth handler is registered on line 26 **before** the CORS middleware on line 31 for `/api/*`. In Hono, `app.on()` registers a handler, not middleware — so `/api/auth/*` requests bypass CORS entirely. This means:
- No `Access-Control-Allow-Origin` header on auth responses
- No preflight handling for auth endpoints
- Browser cross-origin auth requests may fail or behave unexpectedly

The auth endpoints still work because Better Auth sets its own CORS-like headers internally, but relying on that is fragile.

**Fix:** Move the CORS middleware registration before the auth handler, or add CORS specifically for `/api/auth/*`.

### 12b. Shutdown doesn't close Postgres or ClickHouse connections

**File:** `src/index.ts:90-98`
```ts
async function shutdown() {
  await Promise.all([traceBatcher.shutdown(), spanBatcher.shutdown()]);
  await boss.stop();
  process.exit(0);
}
```
Flushes batchers and stops pg-boss, but doesn't:
- Close the Postgres connection pool (`client.end()`)
- Close the ClickHouse clients (`clickhouse.close()`, `readonlyClickhouse.close()`)
- Stop the HTTP server gracefully (drain in-flight requests)

**Impact:** Low. `process.exit(0)` closes everything, but in-flight requests get dropped and DB connections are not cleanly released.

### 12c. Shutdown doesn't stop cron jobs

**File:** `src/cron.ts`
The `CronJob` instance is created inside `startCronJobs()` but never exposed — there's no way to stop it during shutdown. Not a real issue since `process.exit()` kills everything, but it's incomplete.

### 12d. `spanSample` query has no LIMIT — unbounded result set

**File:** `src/trpc/routes/traces.ts:860-894`
The `spanSample` procedure first fetches ALL trace IDs matching a name (no limit), then fetches ALL spans for ALL those traces. For a popular trace name over 30 days, this could return tens of thousands of spans.

```ts
const traceResult = await readonlyClickhouse.query({
  query: `
    SELECT id
    FROM (...traces subquery...)
    WHERE name = {traceName: String}
    ${dateFilter}
  `,  // NO LIMIT
```

The client-side `InsightsSection.tsx` does client-side aggregation on this data. With many traces, this causes:
- Large ClickHouse query (full table scan + no limit)
- Large JSON response
- Client-side OOM risk

**Fix:** Add `LIMIT 500` or similar to the trace IDs query, and document the sample size.

### 12e. `loopbackRate` has complex CTEs that could be expensive

**File:** `src/trpc/routes/traces.ts:935-968`
The loopback rate query uses multiple CTEs with `ROW_NUMBER()`, `lagInFrame()`, and self-joins. For large datasets, this could time out or consume significant memory. The 60s `request_timeout` on the ClickHouse client provides a safety net.

**Impact:** Low. The query is scoped by project + trace name + date range.

### 12f. `traces.traceId` input is not validated as hex

**File:** `src/trpc/routes/traces.ts:1068`
```ts
.input(z.object({ projectId: z.string().uuid(), traceId: z.string() }))
```
The `traceId` accepts any string. Compare with the ingest schema which validates:
```ts
export const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "trace id must be 32-char hex");
```

This isn't a security issue (ClickHouse parameterization handles it), but it means the API accepts malformed trace IDs and returns empty results without explanation.

**Impact:** Low. DX issue.

### 12g. `projects.list` for public viewing returns ALL orgs without pagination

**File:** `src/trpc/routes/projects.ts:16-18`
```ts
if (!ctx.user) {
  if (!env.allowPublicViewing) throw ...;
  return db.select().from(organization).orderBy(organization.createdAt);
}
```
When public viewing is enabled, this returns every organization in the database. No pagination, no limit.

**Impact:** Low. Public viewing is opt-in and typically used for demos with few projects.

### 12h. `jose` imported but never used

**File:** `package.json:36`
```json
"jose": "^6.1.3",
```
The `jose` library (JWT) is listed as a dependency but not imported anywhere in the source. Better Auth handles its own JWT/session management. Dead dependency.

**Impact:** None. Slight bundle bloat.

### 12i. No `onConflict` handling in `observationViews` composite key

**File:** `src/db/schema.ts:201-203`
```ts
}, (t) => [
  { name: "observation_views_pkey", columns: [t.userId, t.projectId] },
]);
```
This defines a composite primary key constraint but uses Drizzle's index syntax rather than the proper `primaryKey()` helper. The `markViewed` mutation uses `onConflictDoUpdate` targeting both columns, which works with a proper composite unique/pk constraint, but this syntax may not create the constraint correctly in all Drizzle versions.

**Impact:** Low. Would manifest as a duplicate row error on second markViewed call.

### 12j. SPA fallback in production reads index.html on EVERY request

**File:** `src/index.ts:64-67`
```ts
app.get("*", async (c) => {
  const html = await readFile("./public/index.html", "utf-8");
  return c.html(html);
});
```
Every non-static GET request reads `index.html` from disk. This should be cached in memory at startup.

**Fix:**
```ts
const indexHtml = await readFile("./public/index.html", "utf-8");
app.get("*", (c) => c.html(indexHtml));
```

**Impact:** Low. File system cache will handle it, but a memory cache is trivially better.

### 12k. `stats` procedure runs two sequential ClickHouse queries

**File:** `src/trpc/routes/traces.ts:89-221`
The `stats` procedure runs the current period query, then if date filters exist, runs a separate query for the previous period. These are independent and could run in parallel with `Promise.all()`.

**Impact:** Low. Each query is fast.

---

## Recommended Priority Order

1. **Fix traces auth** — Change all `procedure` to `orgViewerProcedure` in traces.ts
2. **Validate AI-generated SQL** — Sanitize or sandbox the clause from `writeSearchQuery()`
3. **Verify explore ownership in chat** — Check exploreId belongs to projectId
4. **Validate env at startup** — Zod schema for `betterAuthSecret`, `encryptionKey`, etc.
5. **Configure Better Auth rate limiting** — Especially for sign-in/sign-up
6. **Conditional trusted origins** — Remove localhost in production
7. **Add security headers** — `hono/secure-headers`
8. **Wrap requery in try/catch** — Return structured error, not raw CH details
9. **Add LIMIT to spanSample query** — Prevent unbounded result sets
10. **Cache index.html in memory** — Avoid per-request disk read
11. **Fix CORS ordering for auth routes** — Register CORS before auth handler
12. **Add audit logging** — Better Auth databaseHooks + structured logger
13. **Remove unused `jose` dependency** — Dead code
14. **Parallelize stats queries** — Run current + previous period concurrently
