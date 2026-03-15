# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev          # Start Docker infrastructure + server + web (full stack)
npm run dev:packages # Dev mode for SDK packages only
npm run db:up        # Start Docker containers (Postgres + ClickHouse)
npm run db:down      # Stop Docker containers
npm run db:reset     # Reset Docker containers and volumes
```

### Build & Type Checking
```bash
npm run build        # Build all workspaces via Turbo
npm run typecheck    # TypeScript type checking across all workspaces
npm run clean        # Clean build artifacts
```

### Testing
```bash
npm run test                          # Run tests across all workspaces
npx vitest run --filter=<test-name>   # Run a single test (from workspace root)
```

### Database Migrations (from services/server)
```bash
npm run db:generate  # Generate Drizzle migration files
npm run db:migrate   # Apply Postgres migrations
```

### SDK Packages (from packages/*)
```bash
npm run build        # Bundle with tsdown
npm run dev          # Watch mode
```

## Architecture

**Monorepo** managed with Turbo. Workspaces: `packages/*`, `services/*`, `apps/*`, `examples`.

### Services & Apps

- **`services/server`** — Hono HTTP server (port 3100). Dual-database: PostgreSQL (Drizzle ORM) for relational data (projects, API keys), ClickHouse for trace/span analytics. Exposes:
  - `/v1/*` — Trace ingestion API (API key auth)
  - `/trpc/*` — tRPC procedures (session auth)
  - `/auth` — Authentication routes (JWT via jose)
  - `/mcp` — Model Context Protocol endpoint for LLM tool integration

- **`apps/web`** — React 19 SPA (Vite 6 + TanStack Router + tRPC client + React Query). File-based routing under `src/routes/`. Communicates with server exclusively via tRPC.

- **`apps/docs`** — Next.js app serving both the marketing homepage and Fumadocs docs under `/docs`.

### Packages

- **`packages/sdk-typescript`** — Main SDK (`Breadcrumb` class). Wraps `core` to expose `TraceHandle` and `SpanHandle` for instrumentation.
- **`packages/core`** — Low-level `IngestClient` (HTTP client for posting traces/spans to `/v1/*`).

### Infrastructure

Docker Compose (`infra/docker-compose.yml`) runs PostgreSQL 16 and ClickHouse 24. Required for local development.

### Key Patterns

- **Full-stack type safety**: tRPC definitions in `services/server/src/trpc/` are consumed by `apps/web` with shared types.
- **Dual database**: PostgreSQL stores projects/API keys; ClickHouse stores all trace/span time-series data.
- **SDK instrumentation flow**: `Breadcrumb` → `TraceHandle` → `SpanHandle` → `IngestClient` → `/v1/ingest`.
- **MCP integration**: Server exposes tools for querying traces from LLM clients (Claude, etc.).

### Environment

Copy `.env.example` to `.env` in `services/server/` before running locally. Requires Node 20+, npm 10+.
