import { eq } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { db } from "../../shared/db/postgres.js";
import { explores } from "../../shared/db/schema.js";
import { getAiModel } from "./ai-provider.js";
import { streamChartGeneration, type ChartSpec } from "./chart-generator.js";
import { startGeneration } from "./generation-manager.js";
import type { DisplayPart, StreamEvent } from "./types.js";

/**
 * Kick off a background chart generation for a given explore.
 * Fire-and-forget — errors are pushed as stream events.
 */
export function runGeneration(
  exploreId: string,
  projectId: string,
  prompt: string,
) {
  const { push, signal } = startGeneration(exploreId);

  // Fire-and-forget — errors are pushed as events
  (async () => {
    try {
      const model = await getAiModel(projectId);

      const [explore] = await db
        .select({ messages: explores.messages, name: explores.name })
        .from(explores)
        .where(eq(explores.id, exploreId));

      const existingParts = (explore?.messages ?? []) as DisplayPart[];

      const aiMessages: ModelMessage[] = [];
      for (const part of existingParts) {
        if (part.type === "user") {
          aiMessages.push({ role: "user", content: part.content });
        } else if (part.type === "text") {
          aiMessages.push({ role: "assistant", content: part.content });
        }
      }
      aiMessages.push({ role: "user", content: prompt });

      const newParts: DisplayPart[] = [{ type: "user", content: prompt }];
      const charts: { spec: ChartSpec; data: Record<string, unknown>[] }[] = [];

      const result = streamChartGeneration({
        model,
        messages: aiMessages,
        projectId,
        abortSignal: signal,
        onChartUpdate: (spec, data) => {
          charts.push({ spec, data });
        },
      });

      let currentText = "";

      for await (const event of result.fullStream) {
        switch (event.type) {
          case "text-delta":
            currentText += event.text;
            push({ type: "text-delta", content: event.text });
            break;

          case "tool-call":
            if (currentText) {
              newParts.push({ type: "text", content: currentText });
              currentText = "";
            }
            push({ type: "tool-call", toolName: event.toolName, args: event.input });
            break;

          case "tool-result":
            if (event.toolName === "display_chart" && charts.length > 0) {
              const latest = charts[charts.length - 1];
              newParts.push({ type: "chart", spec: latest.spec, data: latest.data });
              push({ type: "chart", spec: latest.spec, data: latest.data });
            }
            push({ type: "tool-result", toolName: event.toolName, result: event.output });
            break;

          case "error":
            push({
              type: "error",
              message: event.error instanceof Error ? event.error.message : "Stream error",
            });
            break;
        }
      }

      // Flush remaining text
      if (currentText) {
        newParts.push({ type: "text", content: currentText });
      }

      // Persist
      if (newParts.length > 1) {
        const allParts = [...existingParts, ...newParts];
        const updateData: Record<string, unknown> = {
          messages: allParts,
          updatedAt: new Date(),
        };

        const isFirstMessage = existingParts.length === 0;
        if (isFirstMessage) {
          updateData.name =
            prompt.length > 40 ? prompt.slice(0, 37) + "..." : prompt;
        }

        await db
          .update(explores)
          .set(updateData)
          .where(eq(explores.id, exploreId));

        push({
          type: "done",
          ...(isFirstMessage ? { name: updateData.name as string } : {}),
        });
      } else {
        push({ type: "done" });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      push({
        type: "error",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    }
  })();
}
