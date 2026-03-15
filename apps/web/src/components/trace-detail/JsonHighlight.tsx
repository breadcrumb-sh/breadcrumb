import { useEffect, useState } from "react";
import { createHighlighter } from "shiki";

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: ["json"],
    });
  }
  return highlighterPromise;
}

export function JsonHighlight({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    getHighlighter().then((hl) => {
      setHtml(
        hl.codeToHtml(content, {
          lang: "json",
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        }),
      );
    });
  }, [content]);

  if (html === null) {
    return (
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
        {content}
      </pre>
    );
  }

  return (
    <div className="json-highlight" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
