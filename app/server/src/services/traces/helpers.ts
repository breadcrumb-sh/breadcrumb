/**
 * Shared query helpers for trace/span ClickHouse queries.
 * Extracted from trpc/routes/traces.ts so both tRPC and MCP can reuse them.
 *
 * No framework imports — pure functions and SQL fragments only.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../shared/db/postgres.js";
import { project } from "../../shared/db/schema.js";

// ── toStr ────────────────────────────────────────────────────────────────────

/**
 * Safely stringify a CH value for tRPC responses.
 * ClickHouse Map columns (e.g. metadata) come back as JS objects from JSONEachRow.
 * String() on an object produces "[object Object]", so we serialize explicitly.
 */
export function toStr(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

// ── ROLLUPS_SUBQUERY ─────────────────────────────────────────────────────────

/**
 * Reusable rollups subquery fragment.
 * Returns a SQL subquery string that aggregates trace_rollups for a single project.
 *
 * @param projectIdParam — The named parameter key to use in the query
 *   (e.g. "projectId" produces `{projectId: UUID}`).
 */
export const ROLLUPS_SUBQUERY = (projectIdParam: string) => `
  SELECT
    trace_id,
    sum(input_tokens)                     AS input_tokens,
    sum(output_tokens)                    AS output_tokens,
    sum(input_cost_usd)                   AS input_cost_usd,
    sum(output_cost_usd)                  AS output_cost_usd,
    sum(span_count)                       AS span_count,
    max(max_end_time)                     AS max_end_time
  FROM breadcrumb.trace_rollups
  WHERE project_id = {${projectIdParam}: UUID}
  GROUP BY trace_id
`;

// ── buildTraceFilters ────────────────────────────────────────────────────────

/**
 * Build the WHERE clauses and params for the shared tRPC filter set.
 * All filters are optional — omitting them returns all-time / unfiltered data.
 */
export function buildTraceFilters(input: {
  projectId: string;
  from?: string;
  to?: string;
  environments?: string[];
  models?: string[];
  names?: string[];
}) {
  const clauses: string[] = [];
  const params: Record<string, unknown> = { projectId: input.projectId };

  if (input.from) {
    clauses.push(`t.start_time >= {from: Date}`);
    params.from = input.from;
  }
  if (input.to) {
    clauses.push(`t.start_time < {to: Date} + INTERVAL 1 DAY`);
    params.to = input.to;
  }
  if (input.environments && input.environments.length > 0) {
    clauses.push(`t.environment IN {environments: Array(String)}`);
    params.environments = input.environments;
  }
  if (input.names && input.names.length > 0) {
    clauses.push(`t.name IN {names: Array(String)}`);
    params.names = input.names;
  }
  if (input.models && input.models.length > 0) {
    clauses.push(
      `t.id IN (
        SELECT DISTINCT trace_id
        FROM breadcrumb.spans
        WHERE project_id = {projectId: UUID}
          AND model IN {models: Array(String)}
      )`
    );
    params.models = input.models;
  }

  return {
    whereStr: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

// ── filterInput ──────────────────────────────────────────────────────────────

// ── getProjectTimezone ──────────────────────────────────────────────────────

/** Look up the project's configured timezone (defaults to 'UTC'). */
export async function getProjectTimezone(projectId: string): Promise<string> {
  const [p] = await db
    .select({ timezone: project.timezone })
    .from(project)
    .where(eq(project.id, projectId));
  return p?.timezone ?? "UTC";
}

/** Shared Zod filter input schema (all optional for backward compat). */
export const filterInput = {
  from:         z.string().optional(),  // YYYY-MM-DD
  to:           z.string().optional(),  // YYYY-MM-DD
  environments: z.array(z.string()).optional(),
  models:       z.array(z.string()).optional(),
  names:        z.array(z.string()).optional(),
};
