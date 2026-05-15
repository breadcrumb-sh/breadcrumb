# V3 Pivot

Working doc for the v3 platform pivot. Started 2026-05-15 on the `v3` branch.

---

## Direction (locked-in)

- **Audience:** Teams and startups, not solo devs.
- **Product:** Insights-only. Surface where agents miss intent, where users are frustrated, where capabilities are missing. No longer a trace browser.
- **Primary surface:** Web app. GitHub Issues only for **high-confidence** findings (low-confidence GH issues destroy trust).
- **GitHub role:** Grounding first (read code/PRs/issues for intent context); action (create issues) later, only after grounding earns trust.
- **Integration model:** Proxy-style layer in user code. Manual `bc.trace()/bc.span()` is no longer the happy path.
- **Cleanup posture:** Strip down → restructure → reimplement. Nothing is sacred.

---

## Open questions

- [ ] Final proxy shape — wrapper-per-client vs drop-in clients vs Vercel AI SDK telemetry vs hybrid. Leaning **hybrid** (wrapper as default + AI SDK telemetry first-class).
- [ ] Does the proxy capture non-LLM steps (retrieval, tools, business logic)? Pure proxy vs proxy + `track()` escape hatch.
- [ ] What "intent" means concretely per insight feature — agreed approach is feature-by-feature, no grand unified model.
- [ ] Fate of monitor agent / evals / kanban — likely reshaped, not preserved as-is.
- [ ] Insights stream UI shape — feed / timeline / inbox / kanban?
- [ ] Cost analytics — keep, demote, or cut entirely from primary UI?

---

## Process

1. **Strip down** — delete UI surfaces, packages, and code paths that don't serve the new direction. Goal: minimal viable foundation to build on.
2. **Restructure** — clean repo, folder structure, package boundaries, architecture for what remains.
3. **Reimplement** — SDKs (proxy-style), storage (revisit schemas as needed), features (insights stream, GH grounding, etc.).

---

## Phase 1: Strip down

To-confirm candidates for deletion. Nothing deleted until reviewed together.

**Web app routes / UI:**
- [x] Stripped 2026-05-15. Deleted:
  - Routes: `traces.tsx`, `trace.$traceId.tsx`
  - Component dirs: `monitor/`, `overview/`, `trace-detail/`, `traces/`, `design-variants/`
  - Settings sections: Agent Limits/Memory, AI Provider, GitHub, Labels, Model Pricing, Notifications, PII Redaction
  - Common (orphaned after feature deletes): `ChartSkeleton`, `DataTable`, `DateRangePopover`, `MultiselectCombobox`, `Markdown`, `ProgressiveBlur`, `InlineSelect`
  - Hooks/lib: `useProjectFilters`, `span-utils`
- Rewrote: `projects/$projectId.tsx` (nav trimmed to just Settings group), `projects/$projectId/index.tsx` ("No features yet." placeholder), `projects/$projectId/settings.tsx` (3 tabs only)
- `GeneralSection` trimmed (embedded LabelsSection removed)
- Skeleton kept: auth (login/signup/accept-invite), authed shell, orgs (index/new/settings/members), projects (layout/home/settings → general+api-keys+danger), user settings

**Server / packages:**
- [x] `packages/sdk` (`@breadcrumb-sh/sdk`, v0.0.1) — stripped to empty `export {};` entry. Renamed from `packages/sdk-typescript` (`@breadcrumb-sdk/core` v0.0.10). All OpenTelemetry runtime deps removed.
- [x] `packages/ai-sdk` (`@breadcrumb-sh/ai-sdk`, v0.0.1) — same treatment. Renamed from `@breadcrumb-sdk/ai-sdk` v0.0.5. Vitest source-alias removed.
- [x] MCP server, PII redaction, modelRates, monitor agent, internal evals — all stripped 2026-05-15. See decisions log for full list.

**Keep (foundation):**
- ClickHouse + Postgres infrastructure
- Orgs / projects / members / invitations / auth (better-auth)
- Ingest endpoint (`/v1/ingest`) — until new proxy lands a new shape
- GitHub App integration scaffolding (becomes foundational, not shallow)
- Web app shell: sidebar, header, auth routes, settings page chrome

---

## Phase 2: Restructure (in progress)

**Top-level layout (locked in 2026-05-15):**

```
app/             the product (web + server live together)
  web/
  server/
    drizzle/                  Postgres migrations
    clickhouse/migrations/    ClickHouse migrations (moved from infra/)
  shared/        cross-package types (currently empty scaffold)
website/         public marketing + docs (Next.js)
packages/        published SDKs
  sdk/
  ai-sdk/
infra/           container-level configs + both compose files (dev + prod)
notes/
```

Reasoning: `apps/` vs `services/` split was misleading — web and server are one product and belong together. `apps/docs` was actually a public website, not part of the product. The new shape names the actual groups.

Still to consider:
- Rename `docs` package → `@breadcrumb/website` to match its dir? (Currently still `name: "docs"`.)
- Server's internal `src/shared/` may want to move up to `app/shared/` once we know what's actually cross-cutting.
- Re-examine `app/server/src/api/*` boundaries (trpc / mcp / v1) once those are stripped.

---

## Phase 3: Reimplement (notes only)

TBD. High-level order will follow direction decisions:

1. New proxy SDK (whatever shape we land on).
2. Storage adjustments to match what the proxy captures.
3. Insights stream as the new home surface.
4. GitHub grounding for one insight feature end-to-end (proof of model).
5. GitHub issue creation for high-confidence findings (later).

---

## Decisions log

- **2026-05-15** — Pivot to insights-only product on `v3` branch.
- **2026-05-15** — Audience: teams/startups (retired solo-dev wedge).
- **2026-05-15** — Web is primary surface; GH Issues are secondary, high-confidence-only.
- **2026-05-15** — GitHub: grounding before action.
- **2026-05-15** — Integration: proxy-style; current manual SDK retired as happy path.
- **2026-05-15** — Process: strip down → restructure → reimplement (not clean-slate).
- **2026-05-15** — `packages/sdk-typescript` and `packages/ai-sdk` stripped to empty entries. Build/release infra preserved. Downstream importers (services, apps, examples) now broken — expected, queued for next strip-down pass.
- **2026-05-15** — npm scope renamed `@breadcrumb-sdk/*` → `@breadcrumb-sh/*` (matches the .sh domain). Old scope frozen on registry (`core@0.0.10`, `ai-sdk@0.0.5`). New scope packages: `@breadcrumb-sh/sdk` (was `core`) and `@breadcrumb-sh/ai-sdk`, both reset to `0.0.1`. Directory renamed `packages/sdk-typescript/` → `packages/sdk/`. CHANGELOGs reset with rename note. `services/server` and `examples/` dep refs updated to new scope.
- **2026-05-15** — Repo restructure: `apps/web` → `app/web`, `services/server` → `app/server`, `apps/docs` → `website`. Old `apps/` and `services/` containers deleted. New `app/shared/` (`@breadcrumb/shared`) scaffold added for cross-package types. Root `package.json` workspaces, `docker-compose.prod.yml`, and `app/server/Dockerfile` paths updated. `examples/` was already removed by user prior to this pass. All workspace links resolve, SDK builds clean.
- **2026-05-15** — ClickHouse migrations moved `infra/clickhouse/migrations/` → `app/server/clickhouse/migrations/` (mirrors `app/server/drizzle/` for Postgres — server now owns both migration sets). `infra/` kept lean: just container-level configs (`clickhouse/init.sql`, `clickhouse/config.xml`) + dev `docker-compose.yml`. Updated migration runner candidate paths, Dockerfile, and removed redundant Dockerfile COPY (migrations now ride along with `app/server` copy).
- **2026-05-15** — `docker-compose.prod.yml` moved from repo root → `infra/`. Both compose files now live in `infra/`. Updated `context: . → ..`, `env_file` to `../app/server/.env`, and clickhouse mount paths from `./infra/clickhouse/...` → `./clickhouse/...` (relative to new compose location).
- **2026-05-15** — Web UI stripped to skeleton. All per-project feature pages (traces browser, trace detail/span tree, agent monitor/kanban, overview charts) and their component dirs deleted. Project sidebar nav collapsed to just "Settings" group (General / API Keys / Danger). Project home is now a "No features yet." placeholder. Org/project/member/auth skeleton preserved. Web typechecks clean. Server-side tRPC routers for the deleted features (`monitor`, `traces`, `modelRates`, `labels`, `integrations`, `github`, `piiRedaction`, `aiProviders`) are now unused — queued for server-side strip.
- **2026-05-15** — Server + DB stripped to skeleton. **tRPC routers kept:** config, organizations, projects, api-keys, members, invitations. **Removed:** traces/, monitor, labels, ai-providers, integrations, github/, model-rates, pii-redaction, mcp-keys. **Services kept:** ingest (helpers only), cost gone. **Services removed:** monitor/, github/, explore/, mcp/, traces/, cost/, ingest/pii-*. **App routes removed:** /mcp, /integrations/github (and their middleware/rate-limiter). **Schema kept:** instance_settings, user/session/account/verification, organization/member/invitation, project (trimmed: dropped agent_memory, agent_monthly_cost_limit_cents, agent_scan_interval_seconds), api_keys, cache. **Schema removed:** mcp_keys, ai_providers, pii_redaction_settings, pii_custom_patterns, monitor_items/comments/labels/item_labels/activity/scan_runs, agent_usage, webhook_integration, github_installations/tracked_repos, model_rates. **ClickHouse tables untouched** (ingest still writes traces/spans). **Ingest reshape:** dropped PII redaction layer and DB-based cost lookup; span costs only honored if SDK supplies them. **Web cascade:** McpSection removed from `_authed/settings.tsx`. **Deps dropped:** `pg-boss`, `@hono/mcp`, `@modelcontextprotocol/sdk`, `@octokit/app`, `@octokit/core`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`, `ai`, `evalite` (dev). **Files dropped:** `services/cost/`, `services/{monitor,github,explore,mcp,traces}/`, `services/ingest/pii-*`, `shared/auth/mcp-key.ts`, `shared/lib/{boss,litellm-catalog,model-normalization,github-app*,encryption,query-validator,sandboxed-query,state-token}.ts`, `data/litellm-snapshot.json`, `evals/monitor/`, related `__tests__/{monitor,mcp,unit/pii-redactor,unit/encryption,unit/state-token,unit/sandboxed-query,unit/query-validator,unit/clickhouse-config,auth/mcp-key-auth,routes/traces-auth,mcp-helpers}`. Both server and web typecheck clean. **Drizzle migration not yet generated** — user to run `drizzle-kit generate` (interactive prompts may appear for table renames; per memory, claude doesn't run this).
