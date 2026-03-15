import { eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { member, organization, user as userTable } from "../../shared/db/schema.js";

// COALESCE(trace.end_time, rollup.max_end_time):
// trace.end_time is Nullable — NULL when trace.end() was never called.
// max_end_time is the latest span.end_time from trace_rollups.
// Together they give a real duration for any trace that has at least one span.
export const EFFECTIVE_END = `COALESCE(t.end_time, r.max_end_time)`;

export async function getUserProjectIds(userId: string): Promise<string[]> {
  const [u] = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  // Admins can see all projects
  if (u?.role === "admin") {
    const orgs = await db.select({ id: organization.id }).from(organization);
    return orgs.map((o) => o.id);
  }

  const rows = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));
  return rows.map((r) => r.orgId);
}

/**
 * Build a ClickHouse WHERE condition and named params for a set of project IDs.
 * Returns { condition, params } where params are named p0, p1, ...
 */
export function buildProjectCondition(
  projectIds: string[],
  existingParams: Record<string, unknown>
): { condition: string; params: Record<string, unknown> } {
  const params = { ...existingParams };
  if (projectIds.length === 1) {
    params["p0"] = projectIds[0];
    return { condition: `project_id = {p0: UUID}`, params };
  }
  const placeholders = projectIds.map((id, i) => {
    params[`p${i}`] = id;
    return `{p${i}: UUID}`;
  });
  return { condition: `project_id IN (${placeholders.join(", ")})`, params };
}

export const ROLLUPS_JOIN = (condition: string) => `
  LEFT JOIN (
    SELECT
      trace_id,
      sum(input_tokens)    AS input_tokens,
      sum(output_tokens)   AS output_tokens,
      sum(input_cost_usd)  AS input_cost_usd,
      sum(output_cost_usd) AS output_cost_usd,
      sum(span_count)      AS span_count,
      max(max_end_time)    AS max_end_time
    FROM breadcrumb.trace_rollups
    WHERE ${condition}
    GROUP BY trace_id
  ) r ON t.id = r.trace_id
`;

const MAX_QUERY_ROWS = 100;
const MAX_RESULT_CHARS = 8000;

export function truncateResult(rows: Record<string, unknown>[]): { data: string; note: string | null } {
  const capped = rows.slice(0, MAX_QUERY_ROWS);
  let json = JSON.stringify(capped, null, 2);
  const notes: string[] = [];

  if (rows.length > MAX_QUERY_ROWS) {
    notes.push(`showing first ${MAX_QUERY_ROWS} of ${rows.length} rows`);
  }
  if (json.length > MAX_RESULT_CHARS) {
    json = json.slice(0, MAX_RESULT_CHARS);
    // Walk back to the last complete line to avoid broken JSON in the display
    const lastNewline = json.lastIndexOf("\n");
    if (lastNewline > 0) json = json.slice(0, lastNewline);
    notes.push(`output truncated at ${MAX_RESULT_CHARS} chars`);
  }

  return { data: json, note: notes.length ? notes.join(", ") : null };
}
