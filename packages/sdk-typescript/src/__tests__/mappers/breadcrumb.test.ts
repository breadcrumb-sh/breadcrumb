import { describe, it, expect } from "vitest";
import { mapBreadcrumb } from "../../mappers/breadcrumb.js";
import { makeSpan } from "./helpers.js";

// ── Input / output ────────────────────────────────────────────────────────────

describe("mapBreadcrumb — input / output", () => {
  it("returns undefined input and output when no breadcrumb attributes are set", () => {
    const result = mapBreadcrumb(makeSpan());
    expect(result.input).toBeUndefined();
    expect(result.output).toBeUndefined();
  });

  it("uses breadcrumb.input as a plain string", () => {
    const result = mapBreadcrumb(
      makeSpan({ attributes: { "breadcrumb.input": "What is TypeScript?" } }),
    );
    expect(result.input).toBe("What is TypeScript?");
  });

  it("parses breadcrumb.input when it is a JSON string", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const result = mapBreadcrumb(
      makeSpan({ attributes: { "breadcrumb.input": JSON.stringify(messages) } }),
    );
    expect(result.input).toEqual(messages);
  });

  it("keeps breadcrumb.input as string when JSON.parse fails", () => {
    const result = mapBreadcrumb(
      makeSpan({ attributes: { "breadcrumb.input": "not { valid json" } }),
    );
    expect(result.input).toBe("not { valid json");
  });

  it("uses breadcrumb.output as a plain string", () => {
    const result = mapBreadcrumb(
      makeSpan({ attributes: { "breadcrumb.output": "TypeScript is a typed superset." } }),
    );
    expect(result.output).toBe("TypeScript is a typed superset.");
  });

  it("parses breadcrumb.output when it is a JSON string", () => {
    const obj = { answer: 42 };
    const result = mapBreadcrumb(
      makeSpan({ attributes: { "breadcrumb.output": JSON.stringify(obj) } }),
    );
    expect(result.output).toEqual(obj);
  });
});

// ── Span type override ────────────────────────────────────────────────────────

describe("mapBreadcrumb — type", () => {
  it("returns undefined type when breadcrumb.span.type is not set", () => {
    expect(mapBreadcrumb(makeSpan()).type).toBeUndefined();
  });

  it.each(["llm", "tool", "retrieval", "step"] as const)(
    'maps breadcrumb.span.type = "%s"',
    (type) => {
      const result = mapBreadcrumb(
        makeSpan({ attributes: { "breadcrumb.span.type": type } }),
      );
      expect(result.type).toBe(type);
    },
  );
});

// ── Model / provider / tokens / cost ─────────────────────────────────────────

describe("mapBreadcrumb — model, provider, tokens, cost", () => {
  it("maps breadcrumb.model → model", () => {
    expect(
      mapBreadcrumb(makeSpan({ attributes: { "breadcrumb.model": "claude-opus-4-6" } })).model,
    ).toBe("claude-opus-4-6");
  });

  it("maps breadcrumb.provider → provider", () => {
    expect(
      mapBreadcrumb(makeSpan({ attributes: { "breadcrumb.provider": "anthropic" } })).provider,
    ).toBe("anthropic");
  });

  it("maps breadcrumb.input_tokens → input_tokens", () => {
    expect(
      mapBreadcrumb(makeSpan({ attributes: { "breadcrumb.input_tokens": 200 } })).input_tokens,
    ).toBe(200);
  });

  it("maps breadcrumb.output_tokens → output_tokens", () => {
    expect(
      mapBreadcrumb(makeSpan({ attributes: { "breadcrumb.output_tokens": 100 } })).output_tokens,
    ).toBe(100);
  });

  it("maps breadcrumb.input_cost_usd → input_cost_usd", () => {
    expect(
      mapBreadcrumb(makeSpan({ attributes: { "breadcrumb.input_cost_usd": 0.0012 } }))
        .input_cost_usd,
    ).toBe(0.0012);
  });

  it("maps breadcrumb.output_cost_usd → output_cost_usd", () => {
    expect(
      mapBreadcrumb(makeSpan({ attributes: { "breadcrumb.output_cost_usd": 0.0008 } }))
        .output_cost_usd,
    ).toBe(0.0008);
  });

  it("returns undefined for all fields when no breadcrumb attributes are set", () => {
    const result = mapBreadcrumb(makeSpan());
    expect(result.model).toBeUndefined();
    expect(result.provider).toBeUndefined();
    expect(result.input_tokens).toBeUndefined();
    expect(result.output_tokens).toBeUndefined();
    expect(result.input_cost_usd).toBeUndefined();
    expect(result.output_cost_usd).toBeUndefined();
  });
});

// ── Metadata ──────────────────────────────────────────────────────────────────

describe("mapBreadcrumb — metadata", () => {
  it("returns undefined metadata when no breadcrumb.meta.* attributes are set", () => {
    expect(mapBreadcrumb(makeSpan()).metadata).toBeUndefined();
  });

  it("strips breadcrumb.meta. prefix and collects into metadata", () => {
    const result = mapBreadcrumb(
      makeSpan({
        attributes: {
          "breadcrumb.meta.score": "0.95",
          "breadcrumb.meta.environment": "production",
        },
      }),
    );
    expect(result.metadata).toEqual({ score: "0.95", environment: "production" });
  });

  it("converts non-string breadcrumb.meta.* values to strings", () => {
    const result = mapBreadcrumb(
      makeSpan({
        attributes: {
          "breadcrumb.meta.count": 42,
          "breadcrumb.meta.active": true,
        },
      }),
    );
    expect(result.metadata).toEqual({ count: "42", active: "true" });
  });

  it("ignores breadcrumb.* attributes that are not breadcrumb.meta.*", () => {
    // breadcrumb.model, breadcrumb.input etc. should NOT appear in metadata
    const result = mapBreadcrumb(
      makeSpan({
        attributes: {
          "breadcrumb.model": "gpt-4o",
          "breadcrumb.input": "hello",
          "breadcrumb.meta.tag": "test",
        },
      }),
    );
    expect(Object.keys(result.metadata ?? {})).toEqual(["tag"]);
  });
});
