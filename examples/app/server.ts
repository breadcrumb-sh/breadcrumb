/**
 * Chat example server — Hono + AI SDK v6 + Breadcrumb tracing.
 *
 * Demonstrates:
 *   - initAiSdk(bc) to get the telemetry helper
 *   - telemetry("step-name") passed to streamText / generateText
 *   - bc.span() for manual retrieval spans — nested under the AI SDK spans
 *     via active OTel context propagation
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
import { init } from "@breadcrumb/sdk";
import { initAiSdk } from "@breadcrumb/ai-sdk";
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

const bc = init({
  apiKey,
  baseUrl: process.env["BREADCRUMB_BASE_URL"] ?? "http://localhost:3100",
});

const { telemetry } = initAiSdk(bc);

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

  const result = streamText({
    model: openrouter.chat(MODEL, { usage: { include: true } }),
    system:
      "You are a helpful assistant. Use the available tools to look up real data. " +
      "Always call a tool when the user asks about weather or wants information you should look up.",
    messages,
    stopWhen: stepCountIs(6),
    experimental_telemetry: telemetry("chat", {
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      userMessage: lastUserText,
    }),
    tools: {
      // ── Tool 1: real weather data from Open-Meteo ───────────────────────
      get_weather: tool({
        description:
          "Get the current weather for a city. Returns temperature (°C), wind speed and conditions.",
        inputSchema: z.object({
          city: z.string().describe("City name, e.g. 'Tokyo' or 'New York'"),
        }),
        execute: async ({ city }) => {
          // bc.span() nests under the active AI SDK OTel context automatically
          return bc.span("weather-lookup", async (span) => {
            const geo = await geocode(city);
            if (!geo) {
              span.set({ input: city, output: "city not found" });
              return { error: `Could not find city: ${city}` };
            }

            const w = await fetchWeather(geo.lat, geo.lon);
            const weatherResult = {
              city: geo.name,
              temperature_c: w.temperature_2m,
              wind_speed_kmh: w.wind_speed_10m,
              condition: weatherDescription(w.weather_code),
            };
            span.set({ input: city, output: weatherResult });
            return weatherResult;
          }, { type: "retrieval" });
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

          // Nested LLM call — nests under the outer chat span via active OTel context
          const { text: summary } = await generateText({
            model: openrouter.chat(MODEL, { usage: { include: true } }),
            prompt: `Summarize the following Wikipedia extract in 2-3 clear sentences:\n\n${extract}`,
            experimental_telemetry: telemetry("summarize"),
          });

          return { title: data.title ?? topic, summary };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
});

const PORT = Number(process.env["PORT"] ?? 3200);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Chat server → http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
});
