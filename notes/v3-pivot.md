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
- [ ] Trace list page as primary view
- [ ] Trace detail / span tree (move to debug drawer or remove)
- [ ] Cost / quality dashboards as currently built
- [ ] Model pricing UI
- [ ] Current kanban-as-process
- [ ] PII redaction settings UI
- [ ] AI providers settings UI (may need a different shape)

**Server / packages:**
- [x] `packages/sdk` (`@breadcrumb-sh/sdk`, v0.0.1) — stripped to empty `export {};` entry. Renamed from `packages/sdk-typescript` (`@breadcrumb-sdk/core` v0.0.10). All OpenTelemetry runtime deps removed.
- [x] `packages/ai-sdk` (`@breadcrumb-sh/ai-sdk`, v0.0.1) — same treatment. Renamed from `@breadcrumb-sdk/ai-sdk` v0.0.5. Vitest source-alias removed.
- [ ] MCP server (low priority for teams/startups — confirm)
- [ ] Built-in PII patterns + custom-pattern infra
- [ ] `modelRates` router + pricing-override flow
- [ ] Current monitor agent + scan/job infra
- [ ] Internal evals (`evals/monitor/`) — may be reused, may be replaced

**Keep (foundation):**
- ClickHouse + Postgres infrastructure
- Orgs / projects / members / invitations / auth (better-auth)
- Ingest endpoint (`/v1/ingest`) — until new proxy lands a new shape
- GitHub App integration scaffolding (becomes foundational, not shallow)
- Web app shell: sidebar, header, auth routes, settings page chrome

---

## Phase 2: Restructure (notes only)

TBD once strip-down reveals what's actually left and what overlaps. Likely targets:

- Reconsider `packages/core` vs `packages/sdk-typescript` split if proxy collapses them.
- Re-examine `services/server/src/api/*` boundaries (trpc / mcp / v1).
- Decide whether `apps/docs` deserves a refresh now or after Phase 3.

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
