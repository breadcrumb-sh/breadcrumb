# Auth & Data Access Audit — services/server

Every endpoint audited for: auth level, data scoping, and issues.

## Auth Level Legend

| Level | Meaning | Checks |
|-------|---------|--------|
| `procedure` | **PUBLIC** — no auth required | None |
| `authedProcedure` | Logged-in user | Session cookie valid |
| `adminProcedure` | Global admin | Session + `user.role === "admin"` |
| `orgMemberProcedure` | Org member | Session + member row with role ∈ {member, admin, owner} |
| `orgAdminProcedure` | Org admin/owner | Session + member row with role ∈ {admin, owner} |
| `orgViewerProcedure` | Org viewer OR public | Member row with any role, OR `ALLOW_PUBLIC_VIEWING=true` (no auth needed) |
| `requireApiKey` | API key (Hono middleware) | `Authorization: Bearer bc_...` → SHA256 → lookup in `api_keys` table |
| `requireMcpKey` | MCP key (Hono middleware) | `Authorization: Bearer mcp_...` → SHA256 → lookup in `mcp_keys` table |

---

## 1. tRPC Endpoints — Traces (`traces.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `traces.stats` | **PUBLIC** | `projectId` (uuid) | CH: traces + rollups WHERE project_id = input | **ISSUE: Any unauthenticated user can query any project's stats by guessing UUID** |
| `traces.list` | **PUBLIC** | `projectId` (uuid) | CH: traces + rollups + optional AI search | **SAME ISSUE** |
| `traces.dailyMetrics` | **PUBLIC** | `projectId` (uuid) | CH: traces + rollups per day | **SAME ISSUE** |
| `traces.dailyCostByName` | **PUBLIC** | `projectId` (uuid) | CH: spans cost per day per name | **SAME ISSUE** |
| `traces.qualityTimeline` | **PUBLIC** | `projectId` (uuid) | CH: traces classified by quality | **SAME ISSUE** |
| `traces.modelBreakdown` | **PUBLIC** | `projectId` (uuid) | CH: spans grouped by provider/model | **SAME ISSUE** |
| `traces.topFailingSpans` | **PUBLIC** | `projectId` (uuid) | CH: spans with errors | **SAME ISSUE** |
| `traces.topSlowestSpans` | **PUBLIC** | `projectId` (uuid) | CH: spans by avg duration | **SAME ISSUE** |
| `traces.environments` | **PUBLIC** | `projectId` (uuid) | CH: distinct environment values | **SAME ISSUE** |
| `traces.models` | **PUBLIC** | `projectId` (uuid) | CH: distinct model values | **SAME ISSUE** |
| `traces.names` | **PUBLIC** | `projectId` (uuid) | CH: distinct trace names | **SAME ISSUE** |
| `traces.dailyCount` | **PUBLIC** | `projectId` (uuid) | CH: daily trace count | **SAME ISSUE** |
| `traces.spanSample` | **PUBLIC** | `projectId` (uuid) | CH: sample spans for insights | **SAME ISSUE** |
| `traces.loopbackRate` | **PUBLIC** | `projectId` (uuid) | CH: span loopback analysis | **SAME ISSUE** |
| `traces.get` | **PUBLIC** | `projectId` (uuid) + `traceId` | CH: single trace detail | **SAME ISSUE** |
| `traces.spans` | **PUBLIC** | `projectId` (uuid) + `traceId` | CH: spans for a trace | **SAME ISSUE** |

**CRITICAL FINDING:** All 16 traces endpoints use bare `procedure` (no auth). When `ALLOW_PUBLIC_VIEWING=false` (the default for non-demo), there is NO authentication or authorization check. Any HTTP client can read any project's trace data by providing a valid UUID.

**Context:** The web client's `_authed.tsx` layout redirects to login if no session and public viewing is off — but this is a client-side guard only. The tRPC API itself is wide open.

**Recommendation:** All traces endpoints should use `orgViewerProcedure` instead of `procedure`. This enforces either org membership OR public viewing is enabled.

---

## 2. tRPC Endpoints — Projects (`projects.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `projects.list` | **PUBLIC** | None | PG: orgs filtered by membership (or all if public viewing) | Manual auth check inside resolver — correct but inconsistent |
| `projects.get` | **PUBLIC** | `id` | PG: single org + membership check | Manual auth check — correct |
| `projects.create` | `adminProcedure` | `name` | PG: inserts org + member | OK |
| `projects.rename` | `authedProcedure` | `id`, `name` | PG: org WHERE id — manual `checkOrgRole(owner)` | OK — only owner can rename |
| `projects.delete` | `adminProcedure` | `id` | PG: delete org + CH: delete traces/spans/rollups | OK — admin only |

**Notes:**
- `list` and `get` use manual auth checks (correct, returns filtered data)
- `rename` requires owner role (checked via `checkOrgRole`)
- All access is properly scoped

---

## 3. tRPC Endpoints — API Keys (`apiKeys.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `apiKeys.list` | `orgMemberProcedure` | `projectId` | PG: api_keys WHERE project_id | OK — member of org |
| `apiKeys.create` | `orgAdminProcedure` | `projectId`, `name` | PG: insert api_key | OK — admin/owner only |
| `apiKeys.delete` | `authedProcedure` | `id` | PG: lookup key → manual `checkOrgRole(admin, owner)` | OK — manual check correct |

---

## 4. tRPC Endpoints — MCP Keys (`mcpKeys.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `mcpKeys.list` | `authedProcedure` | None | PG: mcp_keys WHERE user_id = ctx.user.id | OK — scoped to own user |
| `mcpKeys.create` | `authedProcedure` | `name` | PG: insert with user_id = ctx.user.id | OK |
| `mcpKeys.delete` | `authedProcedure` | `id` | PG: lookup → check userId === ctx.user.id OR admin | OK |

---

## 5. tRPC Endpoints — Members (`members.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `members.list` | `orgMemberProcedure` | `organizationId` | PG: member + user JOIN | OK |
| `members.remove` | `authedProcedure` | `memberId` | PG: lookup member → manual `checkOrgRole(owner, admin)` | OK |

---

## 6. tRPC Endpoints — Invitations (`invitations.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `invitations.create` | `orgAdminProcedure` | `organizationId`, `email`, `role` | PG: check dupe user/invite → insert | OK |
| `invitations.list` | `orgMemberProcedure` | `organizationId` | PG: invitations WHERE org_id AND status=pending | OK |
| `invitations.delete` | `authedProcedure` | `invitationId` | PG: lookup → manual `checkOrgRole(owner, admin)` | OK |

---

## 7. tRPC Endpoints — AI Providers (`aiProviders.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `aiProviders.get` | `orgMemberProcedure` | `projectId` | PG: ai_providers WHERE project_id (returns mask, not key) | OK |
| `aiProviders.upsert` | `orgAdminProcedure` | `projectId`, `provider`, `apiKey`, `modelId`, `baseUrl` | PG: upsert ai_provider with encrypted key | OK |
| `aiProviders.delete` | `orgAdminProcedure` | `projectId` | PG: delete ai_provider WHERE project_id | OK |

---

## 8. tRPC Endpoints — Explores (`explores.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `explores.list` | `orgViewerProcedure` | `projectId` | PG: explores WHERE project_id | OK |
| `explores.get` | **PUBLIC** | `id` | PG: explore by id → manual auth check | **ISSUE: Uses `procedure` not `orgViewerProcedure`. Manual check works but is inconsistent.** |
| `explores.create` | `orgMemberProcedure` | `projectId` | PG: insert explore | OK |
| `explores.delete` | `authedProcedure` | `id` | PG: lookup → manual `checkOrgRole` | OK |
| `explores.rename` | `authedProcedure` | `id`, `name` | PG: lookup → manual `checkOrgRole` | OK |
| `explores.starChart` | `orgMemberProcedure` | `exploreId`, `projectId`, ... | PG: insert starred_chart | OK |
| `explores.unstarChart` | `authedProcedure` | `id` | PG: lookup → manual `checkOrgRole` | OK |
| `explores.listStarred` | `orgViewerProcedure` | `projectId` | PG: starred_charts WHERE project_id | OK |
| `explores.isGenerating` | `orgMemberProcedure` | `exploreId`, `projectId` | In-memory: generation-manager lookup | OK |
| `explores.chat` | `orgMemberProcedure` | `exploreId`, `projectId`, `prompt` | PG + CH: reads explore, runs AI generation | **ISSUE: Doesn't verify exploreId belongs to projectId. User with access to project A could subscribe to generation on project B's explore.** |
| `explores.requery` | `orgViewerProcedure` | `projectId`, `sql` | CH: runs arbitrary SQL with projectId param | **ISSUE: SQL is user-supplied (from saved chart). Read-only CH enforced, but arbitrary SELECT could scan cross-project data if query doesn't use {projectId: UUID}.** |

---

## 9. tRPC Endpoints — Observations (`observations.*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `observations.list` | `orgViewerProcedure` | `projectId` | PG: observations WHERE project_id | OK |
| `observations.create` | `orgMemberProcedure` | `projectId`, `name`, ... | PG: insert observation | OK |
| `observations.setEnabled` | `orgMemberProcedure` | `projectId`, `id` | PG: update WHERE id AND project_id | OK — double-scoped |
| `observations.delete` | `orgMemberProcedure` | `projectId`, `id` | PG: delete WHERE id AND project_id | OK — double-scoped |
| `findings.listAll` | `orgViewerProcedure` | `projectId` | PG: findings WHERE project_id AND not dismissed | OK |
| `findings.listByTrace` | `orgViewerProcedure` | `projectId`, `traceId` | PG: findings WHERE project_id AND trace_id | OK |
| `findings.list` | `orgViewerProcedure` | `projectId`, `observationId` | PG: findings WHERE project_id AND observation_id | OK |
| `findings.dismiss` | `orgMemberProcedure` | `projectId`, `id` | PG: update WHERE id AND project_id | OK — double-scoped |
| `markViewed` | `orgMemberProcedure` | `projectId` | PG: upsert observation_view for user | OK |
| `unreadCount` | `orgViewerProcedure` | `projectId` | PG: count new findings since last view | OK |
| `findings.listNew` | `orgViewerProcedure` | `projectId` | PG: findings newer than last view | OK |
| `queueStats` | `orgViewerProcedure` | `projectId`, `observationId?` | PG: pg-boss job table query | OK — scoped by projectId in job data |

---

## 10. tRPC Endpoints — Config

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `config.publicViewing` | **PUBLIC** | None | Returns env flags only | OK — intentionally public |

---

## 11. Ingest Routes (`/v1/*`)

| Endpoint | Auth | Input Scoping | Data Access | Issue |
|----------|------|--------------|-------------|-------|
| `POST /v1/traces` | `requireApiKey` | `projectId` from API key lookup | CH: insert trace row via batcher | OK — projectId comes from DB, not user input |
| `POST /v1/spans` | `requireApiKey` | `projectId` from API key lookup | CH: insert span rows via batcher | OK — same |

**Notes:** API key maps to exactly one projectId. The user can't override it. Data is always scoped correctly.

---

## 12. MCP Endpoint (`/mcp`)

| Tool | Auth | Input Scoping | Data Access | Issue |
|------|------|--------------|-------------|-------|
| `list_projects` | `requireMcpKey` → userId | userId | PG: orgs via member JOIN | OK |
| `list_traces` | `requireMcpKey` → userId | optional `project_id` | CH: traces WHERE project_id IN user's projects | OK — `getUserProjectIds` enforces membership |
| `get_trace` | `requireMcpKey` → userId | `trace_id`, optional `project_id` | CH: trace + spans WHERE project_id IN user's projects | OK |
| `get_span` | `requireMcpKey` → userId | `span_id`, optional `project_id` | CH: span WHERE project_id IN user's projects | OK |
| `list_spans` | `requireMcpKey` → userId | optional filters | CH: spans WHERE project_id IN user's projects | OK |
| `find_outliers` | `requireMcpKey` → userId | `metric`, optional `project_id` | CH: traces sorted by metric WHERE project_id IN user's projects | OK |
| `introspect_schema` | `requireMcpKey` → userId | None | Returns static schema text | OK |
| `run_query` | `requireMcpKey` → userId | `sql`, `project_id` | CH (readonly): arbitrary SELECT with {projectId: UUID} param | **ISSUE: User supplies SQL. While readonly=1 prevents writes, the query could join/scan data from OTHER projects if it doesn't use {projectId: UUID}. The access check only verifies the user has access to the stated `project_id`, not that the SQL is scoped.** |

---

## 13. Auth Routes (`/api/auth/*`)

| Endpoint | Auth | Notes |
|----------|------|-------|
| `POST /api/auth/sign-up/email` | Public | Guarded by `checkSignupAllowed` (first user free, rest need invitation) |
| `POST /api/auth/sign-in/email` | Public | Email + password |
| `POST /api/auth/sign-out` | Session | Clears session |
| `GET /api/auth/get-session` | Session | Returns current session |
| `POST /api/auth/organization/*` | Session | Better Auth org plugin (accept invitation, etc.) |

**Notes:** Managed by Better Auth. The signup guard is the main custom logic.

---

## Critical Issues Summary

### CRITICAL: All `traces.*` endpoints are unauthenticated

**16 endpoints** serving trace analytics data have zero authentication. Anyone who knows or guesses a project UUID can read all trace data, span data, cost information, model names, environment names, etc.

The web client protects these with a redirect in `_authed.tsx`, but this is client-side only. Direct tRPC calls bypass it completely.

**Fix:** Change all `traces.*` endpoints from `procedure` to `orgViewerProcedure`.

### HIGH: `explores.chat` doesn't verify explore belongs to project

The `orgMemberProcedure` middleware validates the user is a member of the given `projectId`. But it doesn't check that `exploreId` actually belongs to that project. A user with access to project A could:
1. Pass `projectId: "A"` (passes membership check)
2. Pass `exploreId: "<explore from project B>"`
3. Read project B's explore conversation history and trigger generations using B's AI provider config

**Fix:** Add a check: `SELECT project_id FROM explores WHERE id = exploreId` and verify it matches the input `projectId`.

### MEDIUM: `run_query` (MCP) and `requery` (tRPC) allow cross-project reads

Both endpoints accept user/AI-supplied SQL and inject `{projectId: UUID}` as a parameter. But the SQL itself is not analyzed — if it doesn't reference `{projectId: UUID}`, or references `breadcrumb.traces` without a WHERE clause, it returns data from ALL projects.

**Mitigations already in place:**
- ClickHouse `readonly=1` prevents writes
- `requery` uses `orgViewerProcedure` (membership check)
- MCP `run_query` checks user has access to the stated project

**Remaining risk:** The SQL could simply `SELECT * FROM breadcrumb.spans LIMIT 100` and get cross-project data.

**Fix options:**
- Prepend an automatic `AND project_id = {projectId: UUID}` to every query (complex to implement correctly)
- Accept the risk since these are power-user features and the user already has some project access
- Log all queries for audit

### MEDIUM: `explores.get` uses `procedure` with manual auth

Works correctly but is the only endpoint that hand-rolls auth instead of using the appropriate procedure middleware. Should use `orgViewerProcedure` for consistency.

---

## Consistency Matrix

Expected auth levels for operations:

| Operation | Expected Auth | Actual Auth | Consistent? |
|-----------|--------------|-------------|-------------|
| Read project data (traces, charts, etc.) | `orgViewerProcedure` | `procedure` (traces.*) | **NO** |
| Read project config (AI provider, observations) | `orgMemberProcedure` or `orgViewerProcedure` | Correct | YES |
| Write project data (create observation, star chart) | `orgMemberProcedure` | Correct | YES |
| Admin operations (create API key, invite, AI config) | `orgAdminProcedure` | Correct | YES |
| Delete with manual lookup | `authedProcedure` + `checkOrgRole` | Correct | YES |
| Global operations (create project, delete project) | `adminProcedure` | Correct | YES |
| User-scoped data (MCP keys) | `authedProcedure` | Correct | YES |
| Ingest (SDK data) | `requireApiKey` | Correct | YES |
| MCP tools | `requireMcpKey` | Correct | YES |
| Public config | `procedure` | Correct | YES |
