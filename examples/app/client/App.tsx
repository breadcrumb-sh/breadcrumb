import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

// Stable session ID for this browser tab
const sessionId = crypto.randomUUID();

const transport = new DefaultChatTransport({
  api: "/api/chat",
  body: { sessionId },
});

export function App() {
  const { messages, sendMessage, status } = useChat({ transport });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    sendMessage({ text });
  }

  function ask(text: string) {
    if (isLoading) return;
    sendMessage({ text });
  }

  return (
    <div style={s.layout}>
      <header style={s.header}>
        <span style={s.logo}>◆ breadcrumb</span>
        <span style={s.subtitle}>chat demo</span>
      </header>

      <div style={s.messages}>
        {messages.length === 0 && (
          <div style={s.empty}>
            <p>Ask anything. Try:</p>
            <ul style={s.suggestions}>
              {[
                "What's the current weather in Tokyo?",
                "Compare the weather in London and Paris",
                "Tell me about the TypeScript programming language",
                "What's the weather in New York and also explain what a heat island is?",
              ].map((q) => (
                <li key={q} style={s.suggestion} onClick={() => ask(q)}>
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{ ...s.message, ...(msg.role === "user" ? s.userMsg : {}) }}
          >
            <div style={{ ...s.role, ...(msg.role === "user" ? s.roleUser : {}) }}>
              {msg.role === "user" ? "you" : "ai"}
            </div>
            <div style={s.bubble}>
              {msg.parts.map((part, i) => {
                if (part.type === "text") {
                  return <span key={i} style={s.text}>{part.text}</span>;
                }
                if (part.type.startsWith("tool-")) {
                  // In AI SDK v6 the part itself is the tool invocation.
                  // Tool name is encoded in the type: "tool-get_weather" → "get_weather"
                  const toolName = part.type.slice("tool-".length);
                  const p = part as { type: string; toolCallId: string; state: string; input?: unknown; output?: unknown };
                  return (
                    <div key={i} style={s.toolCall}>
                      <span style={s.toolName}>⚙ {toolName}</span>
                      <span style={s.toolArgs}>{JSON.stringify(p.input)}</span>
                      {p.state === "output-available" && (
                        <span style={s.toolResult}>
                          → {JSON.stringify(p.output).slice(0, 160)}
                        </span>
                      )}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {isLoading && messages.at(-1)?.role !== "assistant" && (
          <div style={s.message}>
            <div style={s.role}>ai</div>
            <div style={{ ...s.bubble, ...s.thinking }}>thinking…</div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} style={s.form}>
        <input
          style={s.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a message…"
          disabled={isLoading}
          autoFocus
        />
        <button
          style={{ ...s.button, ...(isLoading ? s.buttonDisabled : {}) }}
          type="submit"
          disabled={isLoading}
        >
          Send
        </button>
      </form>
    </div>
  );
}

const s = {
  layout: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100dvh",
    maxWidth: 760,
    margin: "0 auto",
    width: "100%",
  },
  header: {
    padding: "12px 20px",
    borderBottom: "1px solid #222",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  logo: { fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" as const },
  subtitle: { fontSize: 13, color: "#555" },
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  },
  empty: {
    color: "#555",
    fontSize: 14,
    marginTop: 40,
    textAlign: "center" as const,
  },
  suggestions: {
    listStyle: "none",
    marginTop: 12,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    alignItems: "center",
  },
  suggestion: {
    cursor: "pointer",
    padding: "6px 12px",
    background: "#1a1a1a",
    borderRadius: 6,
    fontSize: 13,
    color: "#888",
    transition: "color 0.1s",
  },
  message: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  },
  userMsg: { flexDirection: "row-reverse" as const },
  role: {
    fontSize: 11,
    fontWeight: 600,
    color: "#555",
    flexShrink: 0,
    paddingTop: 8,
    width: 24,
    textAlign: "right" as const,
  },
  roleUser: { textAlign: "left" as const },
  bubble: {
    background: "#1a1a1a",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
    lineHeight: 1.65,
    maxWidth: "calc(100% - 40px)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  text: { whiteSpace: "pre-wrap" as const },
  thinking: { color: "#555", fontStyle: "italic" as const },
  toolCall: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    background: "#0f0f0f",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "monospace",
    border: "1px solid #222",
  },
  toolName: { color: "#7c6af7", fontWeight: 600 },
  toolArgs: { color: "#666" },
  toolResult: { color: "#4caf87", wordBreak: "break-all" as const },
  form: {
    display: "flex",
    gap: 8,
    padding: "12px 20px",
    borderTop: "1px solid #222",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#e8e8e8",
    fontSize: 14,
    outline: "none",
  },
  button: {
    background: "#7c6af7",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed" as const,
  },
} as const;
