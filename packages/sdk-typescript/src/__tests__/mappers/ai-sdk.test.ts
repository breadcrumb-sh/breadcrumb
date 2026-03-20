import { describe, it, expect } from "vitest";
import { mapAiSdk } from "../../mappers/ai-sdk.js";
import { makeSpan } from "./helpers.js";

// ── Input extraction ──────────────────────────────────────────────────────────

describe("mapAiSdk — input", () => {
  it("returns undefined input when no input attributes are present", () => {
    const result = mapAiSdk(makeSpan());
    expect(result.input).toBeUndefined();
  });

  it("parses ai.prompt.messages JSON string into an array (doGenerate span)", () => {
    const messages = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.prompt.messages": JSON.stringify(messages) } }),
    );
    expect(result.input).toEqual(messages);
  });

  it("normalises ai.prompt {system, prompt} into a messages array (outer generateText span)", () => {
    const prompt = { system: "Be concise.", prompt: "What is 2+2?" };
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.prompt": JSON.stringify(prompt) } }),
    );
    expect(result.input).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "What is 2+2?" },
    ]);
  });

  it("normalises ai.prompt {system, messages:[...]} — prepends system message", () => {
    const msgs = [{ role: "user", content: "Hi" }];
    const prompt = { system: "You are a bot.", messages: msgs };
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.prompt": JSON.stringify(prompt) } }),
    );
    expect(result.input).toEqual([
      { role: "system", content: "You are a bot." },
      { role: "user", content: "Hi" },
    ]);
  });

  it("normalises ai.prompt with only messages (no system)", () => {
    const msgs = [{ role: "user", content: "Hi" }];
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.prompt": JSON.stringify({ messages: msgs }) } }),
    );
    expect(result.input).toEqual(msgs);
  });

  it("falls back to the raw ai.prompt object when it has no known fields", () => {
    const weird = { custom: "data" };
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.prompt": JSON.stringify(weird) } }),
    );
    expect(result.input).toEqual(weird);
  });

  it("ai.toolCall.args is parsed and used as input (tool span)", () => {
    const args = { location: "Berlin", units: "celsius" };
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.toolCall.args": JSON.stringify(args) } }),
    );
    expect(result.input).toEqual(args);
  });

  it("ai.toolCall.args takes priority over ai.prompt.messages", () => {
    const args = { city: "London" };
    const messages = [{ role: "user", content: "hello" }];
    const result = mapAiSdk(
      makeSpan({
        attributes: {
          "ai.toolCall.args": JSON.stringify(args),
          "ai.prompt.messages": JSON.stringify(messages),
        },
      }),
    );
    expect(result.input).toEqual(args);
  });

  it("ai.prompt.messages takes priority over ai.prompt", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = mapAiSdk(
      makeSpan({
        attributes: {
          "ai.prompt.messages": JSON.stringify(messages),
          "ai.prompt": JSON.stringify({ prompt: "ignored" }),
        },
      }),
    );
    expect(result.input).toEqual(messages);
  });
});

// ── Output extraction ─────────────────────────────────────────────────────────

describe("mapAiSdk — output", () => {
  it("returns undefined output when no output attributes are present", () => {
    expect(mapAiSdk(makeSpan()).output).toBeUndefined();
  });

  it("uses ai.response.text as output string", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.response.text": "Paris is the capital of France." } }),
    );
    expect(result.output).toBe("Paris is the capital of France.");
  });

  it("parses ai.response.toolCalls into an array", () => {
    const calls = [
      { toolCallId: "id_1", toolName: "getWeather", input: { location: "Berlin" } },
    ];
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.response.toolCalls": JSON.stringify(calls) } }),
    );
    expect(result.output).toEqual(calls);
  });

  it("parses nested input string inside ai.response.toolCalls items", () => {
    const calls = [
      {
        toolCallId: "id_1",
        toolName: "getWeather",
        input: JSON.stringify({ location: "Berlin" }),
      },
    ];
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.response.toolCalls": JSON.stringify(calls) } }),
    );
    expect((result.output as Array<Record<string, unknown>>)[0].input).toEqual({
      location: "Berlin",
    });
  });

  it("leaves non-JSON nested input as-is inside ai.response.toolCalls", () => {
    const calls = [{ toolCallId: "id_1", toolName: "fn", input: "plain string" }];
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.response.toolCalls": JSON.stringify(calls) } }),
    );
    expect((result.output as Array<Record<string, unknown>>)[0].input).toBe("plain string");
  });

  it("parses ai.toolCall.result as output (tool execution span)", () => {
    const resultData = { temperature: "20°C", condition: "Sunny" };
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.toolCall.result": JSON.stringify(resultData) } }),
    );
    expect(result.output).toEqual(resultData);
  });

  it("ai.toolCall.result takes priority over ai.response.text", () => {
    const resultData = { value: 42 };
    const result = mapAiSdk(
      makeSpan({
        attributes: {
          "ai.toolCall.result": JSON.stringify(resultData),
          "ai.response.text": "ignored",
        },
      }),
    );
    expect(result.output).toEqual(resultData);
  });

  it("ai.toolCall.result takes priority over ai.response.toolCalls", () => {
    const resultData = { done: true };
    const result = mapAiSdk(
      makeSpan({
        attributes: {
          "ai.toolCall.result": JSON.stringify(resultData),
          "ai.response.toolCalls": JSON.stringify([{ toolName: "fn", input: "{}" }]),
        },
      }),
    );
    expect(result.output).toEqual(resultData);
  });

  it("uses ai.response.toolCalls when ai.response.text is absent", () => {
    const calls = [{ toolCallId: "id_1", toolName: "fn", input: {} }];
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.response.toolCalls": JSON.stringify(calls) } }),
    );
    expect(Array.isArray(result.output)).toBe(true);
  });
});

// ── Display name ──────────────────────────────────────────────────────────────

describe("mapAiSdk — name", () => {
  it("returns undefined name when neither ai.toolCall.name nor resource.name is set", () => {
    expect(mapAiSdk(makeSpan()).name).toBeUndefined();
  });

  it("uses resource.name as display name (AI SDK functionId)", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "resource.name": "my-agent" } }),
    );
    expect(result.name).toBe("my-agent");
  });

  it("uses ai.toolCall.name as display name for tool spans", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.toolCall.name": "getWeather" } }),
    );
    expect(result.name).toBe("getWeather");
  });

  it("ai.toolCall.name takes priority over resource.name", () => {
    const result = mapAiSdk(
      makeSpan({
        attributes: {
          "ai.toolCall.name": "getWeather",
          "resource.name": "weather-agent",
        },
      }),
    );
    expect(result.name).toBe("getWeather");
  });
});

// ── Span type inference ───────────────────────────────────────────────────────

describe("mapAiSdk — type inference", () => {
  it.each([
    ["ai.generateText", "llm"],
    ["ai.generateText.doGenerate", "llm"],
    ["ai.streamText", "llm"],
    ["ai.streamText.doStream", "llm"],
    ["ai.generateObject", "llm"],
    ["ai.generateObject.doGenerate", "llm"],
    ["ai.generateObject.doStream", "llm"],
  ])('infers "%s" → "llm"', (spanName, expected) => {
    expect(mapAiSdk(makeSpan({ name: spanName })).type).toBe(expected);
  });

  it.each([
    ["ai.toolCall", "tool"],
    ["ai.toolExecution", "tool"],
    ["ai.executeToolCall", "tool"],
  ])('infers "%s" → "tool"', (spanName, expected) => {
    expect(mapAiSdk(makeSpan({ name: spanName })).type).toBe(expected);
  });

  it('returns "custom" for unrecognised span names', () => {
    expect(mapAiSdk(makeSpan({ name: "my-agent" })).type).toBe("custom");
  });
});

// ── Model / provider / tokens ─────────────────────────────────────────────────

describe("mapAiSdk — model, provider, tokens", () => {
  it("maps ai.model.id → model", () => {
    expect(mapAiSdk(makeSpan({ attributes: { "ai.model.id": "gpt-4o" } })).model).toBe("gpt-4o");
  });

  it("falls back to ai.response.model, then gen_ai.request.model for model", () => {
    expect(
      mapAiSdk(makeSpan({ attributes: { "ai.response.model": "claude-3" } })).model,
    ).toBe("claude-3");
    expect(
      mapAiSdk(makeSpan({ attributes: { "gen_ai.request.model": "mistral-7b" } })).model,
    ).toBe("mistral-7b");
  });

  it("ai.model.id takes priority over ai.response.model and gen_ai.request.model", () => {
    const result = mapAiSdk(
      makeSpan({
        attributes: {
          "ai.model.id": "winner",
          "ai.response.model": "loser",
          "gen_ai.request.model": "also-loser",
        },
      }),
    );
    expect(result.model).toBe("winner");
  });

  it("maps ai.model.provider → provider", () => {
    expect(
      mapAiSdk(makeSpan({ attributes: { "ai.model.provider": "openai" } })).provider,
    ).toBe("openai");
  });

  it("falls back to gen_ai.system for provider", () => {
    expect(
      mapAiSdk(makeSpan({ attributes: { "gen_ai.system": "anthropic" } })).provider,
    ).toBe("anthropic");
  });

  it("maps ai.usage.inputTokens → input_tokens (rounded) on inner spans", () => {
    expect(
      mapAiSdk(makeSpan({ name: "ai.generateText.doGenerate", attributes: { "ai.usage.inputTokens": 100.7 } })).input_tokens,
    ).toBe(101);
  });

  it("falls back to ai.usage.promptTokens for input_tokens", () => {
    expect(
      mapAiSdk(makeSpan({ name: "ai.generateText.doGenerate", attributes: { "ai.usage.promptTokens": 80 } })).input_tokens,
    ).toBe(80);
  });

  it("falls back to gen_ai.usage.input_tokens for input_tokens", () => {
    expect(
      mapAiSdk(makeSpan({ name: "ai.generateText.doGenerate", attributes: { "gen_ai.usage.input_tokens": 60 } })).input_tokens,
    ).toBe(60);
  });

  it("maps ai.usage.outputTokens → output_tokens (rounded) on inner spans", () => {
    expect(
      mapAiSdk(makeSpan({ name: "ai.streamText.doStream", attributes: { "ai.usage.outputTokens": 50.2 } })).output_tokens,
    ).toBe(50);
  });

  it("falls back to ai.usage.completionTokens, then gen_ai.usage.output_tokens for output_tokens", () => {
    expect(
      mapAiSdk(makeSpan({ name: "ai.generateText.doGenerate", attributes: { "ai.usage.completionTokens": 40 } })).output_tokens,
    ).toBe(40);
    expect(
      mapAiSdk(makeSpan({ name: "ai.generateText.doGenerate", attributes: { "gen_ai.usage.output_tokens": 30 } })).output_tokens,
    ).toBe(30);
  });

  it("returns undefined for model/provider/tokens when absent", () => {
    const result = mapAiSdk(makeSpan());
    expect(result.model).toBeUndefined();
    expect(result.provider).toBeUndefined();
    expect(result.input_tokens).toBeUndefined();
    expect(result.output_tokens).toBeUndefined();
  });
});

// ── Wrapper span token/cost suppression ──────────────────────────────────────

describe("mapAiSdk — wrapper spans suppress tokens & cost to avoid double-counting", () => {
  const wrapperNames = ["ai.generateText", "ai.streamText", "ai.generateObject"];

  it.each(wrapperNames)(
    "does not extract tokens from wrapper span %s",
    (spanName) => {
      const result = mapAiSdk(
        makeSpan({
          name: spanName,
          attributes: {
            "ai.usage.inputTokens": 100,
            "ai.usage.outputTokens": 50,
          },
        }),
      );
      expect(result.input_tokens).toBeUndefined();
      expect(result.output_tokens).toBeUndefined();
    },
  );

  it.each(wrapperNames)(
    "does not extract cost from wrapper span %s",
    (spanName) => {
      const meta = {
        openrouter: {
          usage: { cost: 0.0003, promptTokens: 100, completionTokens: 50 },
        },
      };
      const result = mapAiSdk(
        makeSpan({
          name: spanName,
          attributes: {
            "ai.response.providerMetadata": JSON.stringify(meta),
          },
        }),
      );
      expect(result.input_cost_usd).toBeUndefined();
      expect(result.output_cost_usd).toBeUndefined();
    },
  );

  const innerNames = [
    "ai.generateText.doGenerate",
    "ai.streamText.doStream",
    "ai.generateObject.doGenerate",
    "ai.generateObject.doStream",
  ];

  it.each(innerNames)(
    "still extracts tokens from inner span %s",
    (spanName) => {
      const result = mapAiSdk(
        makeSpan({
          name: spanName,
          attributes: {
            "ai.usage.inputTokens": 100,
            "ai.usage.outputTokens": 50,
          },
        }),
      );
      expect(result.input_tokens).toBe(100);
      expect(result.output_tokens).toBe(50);
    },
  );
});

// ── Cost extraction ───────────────────────────────────────────────────────────

describe("mapAiSdk — cost", () => {
  it("returns no cost when ai.response.providerMetadata is absent", () => {
    const result = mapAiSdk(makeSpan({ name: "ai.generateText.doGenerate" }));
    expect(result.input_cost_usd).toBeUndefined();
    expect(result.output_cost_usd).toBeUndefined();
  });

  it("splits total cost by prompt/completion token ratio", () => {
    const meta = {
      openrouter: {
        usage: { cost: 0.0003, promptTokens: 100, completionTokens: 50 },
      },
    };
    const result = mapAiSdk(
      makeSpan({ name: "ai.generateText.doGenerate", attributes: { "ai.response.providerMetadata": JSON.stringify(meta) } }),
    );
    // 100/(100+50) * 0.0003 = 0.0002, 50/150 * 0.0003 ≈ 0.0001
    expect(result.input_cost_usd).toBeCloseTo(0.0002, 6);
    expect(result.output_cost_usd).toBeCloseTo(0.0001, 6);
  });

  it("assigns full cost to input_cost_usd when token counts are zero", () => {
    const meta = {
      openrouter: { usage: { cost: 0.0005 } },
    };
    const result = mapAiSdk(
      makeSpan({ name: "ai.generateText.doGenerate", attributes: { "ai.response.providerMetadata": JSON.stringify(meta) } }),
    );
    expect(result.input_cost_usd).toBe(0.0005);
    expect(result.output_cost_usd).toBeUndefined();
  });

  it("ignores malformed providerMetadata without throwing", () => {
    const result = mapAiSdk(
      makeSpan({ name: "ai.generateText.doGenerate", attributes: { "ai.response.providerMetadata": "not json {{{" } }),
    );
    expect(result.input_cost_usd).toBeUndefined();
  });
});

// ── Metadata pass-through ─────────────────────────────────────────────────────

describe("mapAiSdk — metadata", () => {
  it("returns undefined metadata when no relevant attributes are present", () => {
    expect(mapAiSdk(makeSpan()).metadata).toBeUndefined();
  });

  it("strips ai.telemetry.metadata. prefix and collects into metadata", () => {
    const result = mapAiSdk(
      makeSpan({
        attributes: {
          "ai.telemetry.metadata.userId": "u_123",
          "ai.telemetry.metadata.score": "0.9",
        },
      }),
    );
    expect(result.metadata).toEqual({ userId: "u_123", score: "0.9" });
  });

  it("maps ai.response.finishReason → metadata.finish_reason", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.response.finishReason": "stop" } }),
    );
    expect(result.metadata?.finish_reason).toBe("stop");
  });

  it("drops ai.prompt.tools entirely (not in metadata)", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.prompt.tools": '{"type":"function","name":"fn"}' } }),
    );
    expect(result.metadata?.["ai.prompt.tools"]).toBeUndefined();
  });

  it("drops ai.prompt.toolChoice entirely", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.prompt.toolChoice": '{"type":"auto"}' } }),
    );
    expect(result.metadata?.["ai.prompt.toolChoice"]).toBeUndefined();
  });

  it("drops ai.toolCall.id entirely", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.toolCall.id": "tool_abc123" } }),
    );
    expect(result.metadata?.["ai.toolCall.id"]).toBeUndefined();
  });

  it("drops ai.settings.* attributes entirely", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.settings.temperature": "0.7" } }),
    );
    expect(result.metadata?.["ai.settings.temperature"]).toBeUndefined();
  });

  it("drops ai.request.headers.* attributes entirely", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.request.headers.x-api-key": "secret" } }),
    );
    expect(result.metadata?.["ai.request.headers.x-api-key"]).toBeUndefined();
  });

  it("drops known drop-list attributes (operation.name, ai.operationId, etc.)", () => {
    const result = mapAiSdk(
      makeSpan({
        attributes: {
          "operation.name": "ai.generateText",
          "ai.operationId": "generateText",
          "ai.telemetry.functionId": "my-fn",
          "gen_ai.response.finish_reasons": '["stop"]',
          "gen_ai.response.id": "resp_abc",
          "gen_ai.response.model": "gpt-4o",
          "ai.response.id": "resp_xyz",
          "ai.response.timestamp": "2026-01-01T00:00:00Z",
        },
      }),
    );
    expect(result.metadata).toBeUndefined();
  });

  it("passes through unrecognised ai.* attributes as metadata", () => {
    const result = mapAiSdk(
      makeSpan({ attributes: { "ai.someNewAttribute": "value" } }),
    );
    expect(result.metadata?.["ai.someNewAttribute"]).toBe("value");
  });
});
