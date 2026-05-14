import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function TraceChat({ traceId }: { traceId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    // TODO: send to backend and stream response
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-sm text-zinc-400">Ask about this trace</p>
            <p className="text-xs text-zinc-600 mt-1">
              Ask questions about the spans, performance, errors, or anything else.
            </p>
          </div>
        ) : (
          messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-700/50 px-4 py-2.5 text-sm text-zinc-100 whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={i} className="text-sm text-zinc-300 whitespace-pre-wrap">
                {msg.content}
              </div>
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-zinc-800/60 px-3 py-3">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this trace..."
            rows={1}
            className="w-full resize-none overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2.5 pr-10 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            className="absolute right-2 bottom-2 p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <PaperPlaneTilt size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
