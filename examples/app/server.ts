/**
 * Chat example server — Hono + AI SDK v6 + Breadcrumb tracing.
 *
 * Demonstrates:
 *   - useAiSdkTracing(bc) to bind the client once
 *   - traceAgent() per request for a multi-step trace
 *   - agent.step("chat") passed to streamText — LLM + tool spans auto-nested
 *   - agent.track() for manual retrieval spans (weather geocoding)
 *   - Nested generateText inside tool execute() using the same step config,
 *     so OTEL context propagation places the inner call under the outer span
 *
 * Tools use real public APIs (no API key required):
 *   - get_weather       → Open-Meteo (geocoding + forecast)
 *   - search_wikipedia  → Wikipedia REST API, summarized via a nested LLM call
 *
 * Run: npm run dev --workspace=examples
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamText, generateText, tool, convertToModelMessages, stepCountIs } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { useAiSdkTracing } from "@breadcrumb/ai-sdk";
import { Breadcrumb } from "@breadcrumb/sdk";
import { z } from "zod";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from examples/ directory
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env") });

const apiKey = process.env["BREADCRUMB_API_KEY"];
if (!apiKey) {
  console.error("Missing BREADCRUMB_API_KEY in examples/.env");
  process.exit(1);
}

if (!process.env["OPENROUTER_API_KEY"]) {
  console.error("Missing OPENROUTER_API_KEY in examples/.env");
  process.exit(1);
}

const bc = new Breadcrumb({
  apiKey,
  baseUrl: process.env["BREADCRUMB_BASE_URL"] ?? "http://localhost:3100",
});

// Bind helpers to the client once — shared across all requests.
const { traceAgent } = useAiSdkTracing(bc);

const openrouter = createOpenRouter({
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

const MODEL = process.env["MODEL"] ?? "anthropic/claude-3.5-haiku";

// ── Tool helpers ──────────────────────────────────────────────────────────────

async function geocode(
  city: string,
): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    results?: Array<{ latitude: number; longitude: number; name: string }>;
  };
  const r = data.results?.[0];
  if (!r) return null;
  return { lat: r.latitude, lon: r.longitude, name: r.name };
}

async function fetchWeather(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,weather_code&temperature_unit=celsius`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    current: { temperature_2m: number; wind_speed_10m: number; weather_code: number };
  };
  return data.current;
}

function weatherDescription(code: number): string {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 49) return "foggy";
  if (code <= 69) return "rainy";
  if (code <= 79) return "snowy";
  if (code <= 99) return "stormy";
  return "unknown";
}

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

app.post("/api/chat", async (c) => {
  const body = await c.req.json<{
    messages: Parameters<typeof convertToModelMessages>[0];
    id: string;
    sessionId?: string;
  }>();

  const messages = await convertToModelMessages(body.messages);
  const lastUserText =
    body.messages
      .filter((m) => m.role === "user")
      .at(-1)
      ?.parts?.find((p) => p.type === "text")?.text ?? "";

  // One agent trace per request.
  const agent = traceAgent({
    name: "chat",
    input: { message: lastUserText },
    sessionId: body.sessionId,
  });

  // Save the step so we can reuse the same BcTracer for nested LLM calls
  // inside tool execute() — OTEL context then nests them under the outer span.
  const chatStep = agent.step("chat");

  const result = streamText({
    model: openrouter.chat(MODEL, { usage: { include: true } }),
    system:
      "You are a helpful assistant. Use the available tools to look up real data. " +
      "Always call a tool when the user asks about weather or wants information you should look up.",
    messages,
    stopWhen: stepCountIs(6),
    experimental_telemetry: chatStep,
    tools: {
      // ── Tool 1: real weather data from Open-Meteo ───────────────────────
      get_weather: tool({
        description:
          "Get the current weather for a city. Returns temperature (°C), wind speed and conditions.",
        inputSchema: z.object({
          city: z.string().describe("City name, e.g. 'Tokyo' or 'New York'"),
        }),
        execute: async ({ city }) => {
          // Manual retrieval span on the agent — appears alongside the LLM span.
          const tLookup = agent.track("weather-lookup", "retrieval", { input: { city } });

          const geo = await geocode(city);
          if (!geo) {
            tLookup.end({ output: { error: "city not found" } });
            return { error: `Could not find city: ${city}` };
          }

          const w = await fetchWeather(geo.lat, geo.lon);
          const weatherResult = {
            city: geo.name,
            temperature_c: w.temperature_2m,
            wind_speed_kmh: w.wind_speed_10m,
            condition: weatherDescription(w.weather_code),
          };
          tLookup.end({ output: weatherResult });
          return weatherResult;
        },
      }),

      // ── Tool 2: Wikipedia lookup with nested LLM summarization ──────────
      search_wikipedia: tool({
        description:
          "Look up a topic on Wikipedia and return a concise summary. " +
          "Use this for factual questions about people, places, events or concepts.",
        inputSchema: z.object({
          topic: z.string().describe("Topic to look up, e.g. 'TypeScript programming language'"),
        }),
        execute: async ({ topic }) => {
          const slug = encodeURIComponent(topic.replace(/ /g, "_"));
          const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
          const res = await fetch(url, { headers: { "User-Agent": "breadcrumb-demo/1.0" } });

          if (!res.ok) return { error: `Wikipedia article not found for: ${topic}` };

          const data = (await res.json()) as { extract?: string; title?: string };
          const extract = data.extract ?? "";
          if (!extract) return { error: `No content found for: ${topic}` };

          // Nested LLM call using the same chatStep — OTEL context propagation
          // detects it's inside the outer doStream span and nests it accordingly.
          const { text: summary } = await generateText({
            model: openrouter.chat(MODEL, { usage: { include: true } }),
            prompt: `Summarize the following Wikipedia extract in 2-3 clear sentences:\n\n${extract}`,
            experimental_telemetry: chatStep,
          });

          return { title: data.title ?? topic, summary };
        },
      }),
    },
    onFinish: ({ text }) => {
      agent.end({ output: text });
    },
    onError: ({ error }) => {
      agent.end({
        status: "error",
        statusMessage: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return result.toUIMessageStreamResponse();
});

const PORT = Number(process.env["PORT"] ?? 3200);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Chat server → http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
});
