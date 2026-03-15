import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { eq, and, or, ilike, sql } from "drizzle-orm";
import { boss } from "../lib/boss.js";
import { db } from "../db/index.js";
import { observations, observationFindings } from "../db/schema.js";
import { runSandboxedQuery } from "../lib/sandboxed-query.js";
import { getAiModel } from "../lib/ai-provider.js";
import { CLICKHOUSE_SCHEMA } from "../lib/clickhouse-schema.js";
import { invalidateObservationsCache } from "../lib/observations-cache.js";

// In-process mutex per observationId — prevents concurrent jobs for the same
// observation from creating duplicate findings. Safe because pg-boss workers
// run in a single Node.js process.
const locks = new Map<string, Promise<void>>();

async function withObservationLock<T>(observationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(observationId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(observationId, next);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (locks.get(observationId) === next) locks.delete(observationId);
  }
}

const JOB_NAME = "evaluate-observation";
const CONCURRENCY = Number(process.env.OBSERVATION_CONCURRENCY) || 5;

interface JobData {
  projectId: string;
  traceId: string;
  observationId: string;
}

async function handleJob(job: { data: JobData }) {
  const { projectId, traceId, observationId } = job.data;
  console.log(`[obs-job] starting job — observation=${observationId} trace=${traceId}`);
  return withObservationLock(observationId, () =>
    handleJobLocked({ projectId, traceId, observationId }),
  );
}

async function handleJobLocked({
  projectId,
  traceId,
  observationId,
}: JobData) {

  // Load observation
  const [observation] = await db
    .select()
    .from(observations)
    .where(and(eq(observations.id, observationId), eq(observations.projectId, projectId)));

  if (!observation) {
    console.warn(`[obs-job] observation ${observationId} not found, skipping`);
    return;
  }
  console.log(`[obs-job] loaded observation "${observation.name}"`);

  // Load existing findings
  const existingFindings = await db
    .select()
    .from(observationFindings)
    .where(
      and(
        eq(observationFindings.observationId, observationId),
        eq(observationFindings.referenceTraceId, traceId),
      ),
    );
  console.log(`[obs-job] ${existingFindings.length} existing finding(s) for this trace`);

  // Get AI model
  let model;
  try {
    model = await getAiModel(projectId);
    console.log(`[obs-job] AI model loaded`);
  } catch (err) {
    console.warn(`[obs-job] no AI provider configured for project ${projectId}:`, err);
    return;
  }

  const systemPrompt = `You are an AI agent evaluating an LLM application trace for issues and cost optimisation opportunities.

You are analyzing trace "${traceId}" for the observation "${observation.name}".

${observation.heuristics ? `Observation focus / heuristics:\n${observation.heuristics}\n` : ""}

CLICKHOUSE SCHEMA:
${CLICKHOUSE_SCHEMA}

SQL RULES:
- project_id param: {projectId: UUID}  — always include this filter
- To filter by this specific trace: AND trace_id='${traceId}'
- To query across ALL traces for the project, omit the trace_id filter
- ClickHouse syntax only. SELECT statements only.
- Cost columns are micro-dollars — divide by 1000000 for USD.

WORKFLOW:
1. Query this trace's spans first:
   SELECT * FROM breadcrumb.spans WHERE project_id={projectId:UUID} AND trace_id='${traceId}' ORDER BY start_time

2. Analyse what you see. Look for:
   - Prompt quality issues (vague instructions, missing context, no output constraints)
   - Repeated or looping tool calls
   - Model refusals or unexpected errors
   - Unnecessarily expensive models for simple subtasks — suggest a cheaper alternative
   - High or wasteful token usage (bloated system prompts, redundant context)
   - Opportunities to cache repeated prompts or reduce calls
   - Poor reasoning steps or inefficient agent paths

3. For any issue you find, use run_query to check how many other traces have the same pattern (omit the trace_id filter). Include the recurrence count in the finding description — e.g. "Seen in 7 of the last 20 traces."

4. Rate the impact of each finding as the effect it would have on the quality of the agent's output:
   - high: directly degrades output correctness or reliability
   - medium: reduces efficiency or increases cost noticeably
   - low: minor, cosmetic, or occasional

5. Before creating a finding, call search_findings with relevant keywords to check if a similar finding already exists for this observation. If one does, update it instead of creating a duplicate.

6. Only create or update findings for real issues. Do nothing if the trace looks fine.`;

  console.log(`[obs-job] running generateText…`);
  await generateText({
    model,
    system: systemPrompt,
    prompt: `Evaluate the trace and create/update findings as appropriate.`,
    stopWhen: stepCountIs(10),
    tools: {
      run_query: tool({
        description:
          "Execute a ClickHouse SELECT query. Use project_id={projectId:UUID} always. " +
          "Add AND trace_id='<id>' to scope to one trace, or omit it to query across all traces.",
        inputSchema: z.object({
          sql: z.string().describe("The ClickHouse SELECT query to run"),
        }),
        execute: async ({ sql }) => {
          try {
            const rows = await runSandboxedQuery(projectId, sql);
            const truncated = rows.slice(0, 100);
            return { success: true as const, rowCount: rows.length, data: JSON.stringify(truncated) };
          } catch (err) {
            return {
              success: false as const,
              error: err instanceof Error ? err.message : "Query failed",
            };
          }
        },
      }),

      search_findings: tool({
        description:
          "Search existing findings for this observation by keywords (checks title and description). " +
          "Call this before creating a finding to avoid duplicates. Returns matching findings you can update instead.",
        inputSchema: z.object({
          keywords: z.array(z.string()).min(1).describe("Keywords to search for"),
        }),
        execute: async ({ keywords }) => {
          const conditions = keywords.map((kw) =>
            or(
              ilike(observationFindings.title, `%${kw}%`),
              ilike(observationFindings.description, `%${kw}%`),
            ),
          );
          const rows = await db
            .select()
            .from(observationFindings)
            .where(
              and(
                eq(observationFindings.observationId, observationId),
                or(...conditions),
              ),
            )
            .limit(10);
          return { count: rows.length, findings: rows };
        },
      }),

      create_finding: tool({
        description: "Create a new finding for an issue discovered in this trace.",
        inputSchema: z.object({
          impact: z.enum(["low", "medium", "high"]),
          title: z.string(),
          description: z.string(),
          suggestion: z.string().optional(),
        }),
        execute: async (input) => {
          const [row] = await db
            .insert(observationFindings)
            .values({
              observationId,
              projectId,
              referenceTraceId: traceId,
              impact: input.impact,
              title: input.title,
              description: input.description,
              suggestion: input.suggestion ?? null,
            })
            .returning();
          return { id: row.id, ...input };
        },
      }),

      update_finding: tool({
        description: "Update an existing finding (e.g. revise impact rating or description).",
        inputSchema: z.object({
          id: z.string().uuid(),
          impact: z.enum(["low", "medium", "high"]).optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          suggestion: z.string().optional(),
        }),
        execute: async ({ id, ...updates }) => {
          const patch: Record<string, unknown> = { updatedAt: new Date() };
          if (updates.impact !== undefined) patch.impact = updates.impact;
          if (updates.title !== undefined) patch.title = updates.title;
          if (updates.description !== undefined) patch.description = updates.description;
          if (updates.suggestion !== undefined) patch.suggestion = updates.suggestion;

          const [row] = await db
            .update(observationFindings)
            .set(patch)
            .where(
              and(
                eq(observationFindings.id, id),
                eq(observationFindings.observationId, observationId),
              ),
            )
            .returning();
          return row ?? { error: "Finding not found" };
        },
      }),
    },
    temperature: 0,
  });
  // Increment counter and auto-pause if trace limit reached
  const [updated] = await db
    .update(observations)
    .set({
      tracesEvaluated: sql`${observations.tracesEvaluated} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(observations.id, observationId))
    .returning();

  if (updated && updated.traceLimit !== null && updated.tracesEvaluated >= updated.traceLimit) {
    await db
      .update(observations)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(observations.id, observationId));
    invalidateObservationsCache(projectId);
    console.log(`[obs-job] trace limit reached (${updated.tracesEvaluated}/${updated.traceLimit}), pausing observation=${observationId}`);
  }

  console.log(`[obs-job] done — observation=${observationId} trace=${traceId}`);
}

export async function registerWorkers() {
  await boss.createQueue(JOB_NAME);
  console.log(`[obs] queue "${JOB_NAME}" ready`);
  console.log(`[obs] registering worker (batchSize=${CONCURRENCY})`);
  boss.work<JobData>(JOB_NAME, { batchSize: CONCURRENCY }, async (jobs) => {
    console.log(`[obs-job] worker picked up ${jobs.length} job(s)`);
    await Promise.allSettled(jobs.map((job) => handleJob(job)));
  });
}
