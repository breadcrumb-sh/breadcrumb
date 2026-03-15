# Server Test Strategy

## Current State

**6 test files, 528 lines** covering:
- `api-key-auth.test.ts` — requireApiKey middleware (4 tests)
- `ingest-helpers.test.ts` — toChDate, toMicroDollars, toJson (15 tests)
- `ingest-routes.test.ts` — POST /v1/traces and /v1/spans (13 tests)
- `mcp-helpers.test.ts` — calcDuration, toUtc, truncateSpanField (8 tests)
- `org-access.test.ts` — checkOrgRole (5 tests)
- `signup-guard.test.ts` — checkSignupAllowed (3 tests)

**Coverage gaps:** tRPC routes, MCP tools, AI generation, ClickHouse queries, encryption, cache, sandboxed query, generation manager, batcher retry logic.

**Framework:** Vitest with `vi.mock()` for dependency isolation.

---

## Test Tiers

### Tier 1: Unit Tests (pure functions, no DB)

Fast, no infrastructure needed. Mock all dependencies. These should cover the bulk of business logic.

| File | What to Test | Priority |
|------|-------------|----------|
| `shared/lib/encryption.ts` | encrypt → decrypt round-trip, invalid key throws, tampered ciphertext fails | HIGH |
| `shared/lib/api-keys.ts` | generateApiKey format, generateMcpKey format, hashApiKey determinism, getKeyPrefix | HIGH |
| `shared/lib/sandboxed-query.ts` | sanitizeSql strips SETTINGS, preserves string literals, handles no SETTINGS, handles edge cases | HIGH |
| `services/ingest/helpers.ts` | Already tested — toChDate, toMicroDollars, toJson | DONE |
| `services/mcp/helpers.ts` | Already tested — calcDuration, toUtc, truncateSpanField | DONE |
| `services/traces/helpers.ts` | buildTraceFilters with various filter combos, ROLLUPS_SUBQUERY output, toStr edge cases | MEDIUM |
| `services/traces/row-mappers.ts` | mapTraceListRow, mapSpanListRow, mapMcpTraceRow — verify field mapping, cost division, null handling | MEDIUM |
| `services/explore/generation-manager.ts` | startGeneration, subscribeGeneration replay, push events, done cleanup, abort | MEDIUM |
| `shared/db/clickhouse-batcher.ts` | Batcher flush, retry on failure, shutdown flushes, maxSize trigger | MEDIUM |
| `env.ts` | Zod validation rejects missing required vars, accepts valid config | LOW |

### Tier 2: Auth & Access Control (mocked DB)

These test the authorization layer — the most security-critical code. Mock the database, test the logic.

| File | What to Test | Priority |
|------|-------------|----------|
| `shared/auth/api-key.ts` | Already tested — requireApiKey middleware | DONE |
| `shared/auth/mcp-key.ts` | requireMcpKey middleware (same pattern as api-key) | HIGH |
| `shared/auth/signup-guard.ts` | Already tested — checkSignupAllowed | DONE |
| `trpc.ts` → checkOrgRole | Already tested — org role checking | DONE |
| `trpc.ts` → orgViewerProcedure | Public viewing bypass, membership check, rejection | HIGH |
| `trpc.ts` → orgMemberProcedure | Member/admin/owner allowed, viewer rejected | HIGH |
| `trpc.ts` → orgAdminProcedure | Admin/owner allowed, member rejected | MEDIUM |

### Tier 3: tRPC Route Tests (mocked DB + CH)

Test each tRPC procedure's input validation, auth enforcement, and response shape. Mock both Postgres (Drizzle) and ClickHouse.

**Critical — auth was recently changed to orgViewerProcedure:**

| Route Group | Procedures to Test | Priority |
|------------|-------------------|----------|
| `api/trpc/traces/*` (16 procedures) | Verify orgViewerProcedure enforced, verify projectId scoping in queries, verify response shape | **HIGH** |
| `api/trpc/explore.ts` | chat — explore-belongs-to-project check, requery — try/catch + sandboxed query, get — viewer role allowed | **HIGH** |
| `api/trpc/projects.ts` | list — public viewing logic, create — slug uniqueness, delete — CH cleanup | MEDIUM |
| `api/trpc/api-keys.ts` | create — returns rawKey, delete — checkOrgRole | MEDIUM |
| `api/trpc/observations.ts` | findings.listAll — impact ordering, markViewed — upsert, unreadCount | MEDIUM |
| `api/trpc/invitations.ts` | create — expired invitation filter, duplicate check | MEDIUM |
| `api/trpc/ai-providers.ts` | upsert — encryption called, get — returns mask not key | MEDIUM |
| `api/trpc/members.ts` | remove — role check | LOW |
| `api/trpc/mcp-keys.ts` | create/delete — user scoping | LOW |
| `api/trpc/config.ts` | publicViewing — returns env flags | LOW |

### Tier 4: MCP Tool Tests (mocked CH)

Test each MCP tool's input handling, project scoping, and response formatting.

| Tool | What to Test | Priority |
|------|-------------|----------|
| `tools/query.ts` → run_query | Project access check, sandboxedQuery called, error handling, truncation | HIGH |
| `tools/traces.ts` → list_traces | Filter building, project scoping via getUserProjectIds, pagination | MEDIUM |
| `tools/traces.ts` → get_trace | Trace + spans fetched in parallel, not-found case | MEDIUM |
| `tools/spans.ts` → list_spans | Filter combinations, project scoping | MEDIUM |
| `tools/projects.ts` → list_projects | Scoped to user's memberships | LOW |

### Tier 5: Integration Tests (real DB, no mocks)

These use real Postgres and ClickHouse (from Docker). Slower, but catch real issues.

**Setup:** Use the existing `npm run db:up` Docker infrastructure. Create a test database.

| Test | What It Validates | Priority |
|------|------------------|----------|
| Ingest → Query round-trip | POST trace + spans via ingest, then read back via traces.list | HIGH |
| Sandboxed query isolation | Insert data for 2 projects, verify sandboxed query only returns one | HIGH |
| Cache set/get/cleanup | Write, read, expire, cleanup cycle | MEDIUM |
| Encryption round-trip with real key | encrypt → decrypt with real ENCRYPTION_KEY | MEDIUM |
| ClickHouse batcher flush | Add rows, verify they appear in CH after flush | MEDIUM |
| Better Auth signup flow | First user becomes admin, second requires invitation | LOW |

### Not Recommended to Test (low ROI)

| Area | Why Skip |
|------|----------|
| Better Auth internals | Tested by the library itself |
| Drizzle query building | ORM is well-tested; our queries are simple |
| ClickHouse SQL correctness | Test via integration tests, not unit tests |
| AI generation quality | Non-deterministic; test the plumbing, not the AI output |
| UI rendering | That's the web app's responsibility |

---

## Proposed Test File Structure

```
__tests__/
  unit/
    encryption.test.ts          ← Tier 1: encrypt/decrypt round-trip
    api-keys.test.ts            ← Tier 1: key generation/hashing
    sandboxed-query.test.ts     ← Tier 1: sanitizeSql
    trace-helpers.test.ts       ← Tier 1: buildTraceFilters, toStr
    row-mappers.test.ts         ← Tier 1: field mapping
    generation-manager.test.ts  ← Tier 1: event streaming
    batcher.test.ts             ← Tier 1: flush/retry logic
    env.test.ts                 ← Tier 1: env validation

  auth/
    api-key-auth.test.ts        ← EXISTING (Tier 2)
    mcp-key-auth.test.ts        ← Tier 2: requireMcpKey
    org-access.test.ts          ← EXISTING (Tier 2)
    signup-guard.test.ts        ← EXISTING (Tier 2)
    viewer-procedure.test.ts    ← Tier 2: orgViewerProcedure public viewing

  routes/
    traces-auth.test.ts         ← Tier 3: verify all 16 procedures use orgViewerProcedure
    explore.test.ts             ← Tier 3: chat ownership check, requery error handling
    projects.test.ts            ← Tier 3: slug collision, CH cleanup
    observations.test.ts        ← Tier 3: findings ordering, markViewed
    invitations.test.ts         ← Tier 3: expiry filter

  mcp/
    run-query.test.ts           ← Tier 4: sandboxed query, access check
    trace-tools.test.ts         ← Tier 4: list/get traces

  ingest/
    ingest-helpers.test.ts      ← EXISTING (Tier 1)
    ingest-routes.test.ts       ← EXISTING (Tier 3)

  helpers/
    mcp-helpers.test.ts         ← EXISTING (Tier 1)

  integration/
    ingest-roundtrip.test.ts    ← Tier 5: needs Docker
    sandboxed-isolation.test.ts ← Tier 5: needs Docker
    cache.test.ts               ← Tier 5: needs Docker
```

---

## Priority Implementation Order

### Phase 1 — Security-Critical (do first)

1. **`sandboxed-query.test.ts`** — sanitizeSql is the last line of defense for SQL injection
2. **`encryption.test.ts`** — crypto correctness is non-negotiable
3. **`traces-auth.test.ts`** — verify the auth fix we just applied to all 16 endpoints
4. **`explore.test.ts`** — verify the chat ownership check we just added

### Phase 2 — Core Business Logic

5. **`api-keys.test.ts`** — key generation format, hashing
6. **`batcher.test.ts`** — retry behavior
7. **`generation-manager.test.ts`** — event replay, cleanup
8. **`mcp-key-auth.test.ts`** — same as api-key but for MCP

### Phase 3 — Route Coverage

9. **`projects.test.ts`** — slug collision, public viewing
10. **`observations.test.ts`** — impact ordering, markViewed
11. **`invitations.test.ts`** — expiry filter
12. **`run-query.test.ts`** — sandboxed query in MCP

### Phase 4 — Integration (when CI has Docker)

13. **`ingest-roundtrip.test.ts`**
14. **`sandboxed-isolation.test.ts`**

---

## Mocking Strategy

| Dependency | How to Mock |
|-----------|-------------|
| Postgres (Drizzle `db`) | `vi.mock("../../shared/db/postgres.js")` — mock `db.select().from().where()` chain |
| ClickHouse (`readonlyClickhouse`) | `vi.mock("../../shared/db/clickhouse.js")` — mock `.query()` to return `{ json: () => rows }` |
| `sandboxedClickhouse` | Same as above, separate mock |
| Better Auth (`auth`) | `vi.mock("../../shared/auth/better-auth.js")` — mock `auth.api.getSession()` |
| pg-boss (`boss`) | `vi.mock("../../shared/lib/boss.js")` — mock `.send()`, `.start()`, `.work()` |
| AI SDK (`generateText`, `streamText`) | `vi.mock("ai")` — mock to return canned responses |
| `getAiModel` | `vi.mock("../../services/explore/ai-provider.js")` — return a mock model |
| `runSandboxedQuery` | `vi.mock("../../shared/lib/sandboxed-query.js")` — return canned rows |
| `crypto.randomUUID` | Use `vi.spyOn(crypto, 'randomUUID')` for deterministic IDs |

---

## Test Helpers to Create

```ts
// __tests__/helpers/mock-clickhouse.ts
export function mockClickhouseQuery(rows: Record<string, unknown>[]) {
  return {
    query: vi.fn().mockResolvedValue({
      json: () => Promise.resolve(rows),
    }),
  };
}

// __tests__/helpers/mock-db.ts
export function mockDbSelect(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue(rows),
          orderBy: vi.fn().mockResolvedValue(rows),
        }),
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

// __tests__/helpers/fixtures.ts
export const VALID_TRACE_ID = "a".repeat(32);
export const VALID_SPAN_ID = "b".repeat(16);
export const TEST_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
export const TEST_USER_ID = "user-test-123";
```

---

## CI Integration

```yaml
# In CI pipeline:
test:
  # Unit + auth + route tests (no Docker needed)
  - npm run test -- --exclude '**/integration/**'

test-integration:
  # Requires Docker services
  services:
    - postgres:16-alpine
    - clickhouse/clickhouse-server:24-alpine
  script:
    - npm run test -- --include '**/integration/**'
```

---

## Coverage Targets

| Area | Current | Target |
|------|---------|--------|
| `shared/lib/` | ~30% (encryption, api-keys untested) | 90% |
| `shared/auth/` | ~50% (api-key tested, mcp-key not) | 90% |
| `services/` | ~10% (only ingest helpers + mcp helpers) | 70% |
| `api/trpc/` | 0% | 60% |
| `api/mcp/` | 0% | 50% |
| `api/ingest/` | ~60% (routes tested) | 80% |
| **Overall** | **~15%** | **65%** |
