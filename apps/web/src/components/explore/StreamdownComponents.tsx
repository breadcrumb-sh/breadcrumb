import { Check } from "@phosphor-icons/react/Check";
import { Copy } from "@phosphor-icons/react/Copy";
import { useEffect, useState } from "react";
import { useTheme } from "../../hooks/useTheme";

// ── Constants ────────────────────────────────────────────────────────────────

export const MERMAID_THEMES = {
  dark: {
    bg: "transparent", fg: "#e9e9ea", line: "#909091", accent: "#58508d",
    muted: "#6c6c6d", surface: "#282829", border: "#363637",
  },
  light: {
    bg: "transparent", fg: "#1d1d1e", line: "#909091", accent: "#58508d",
    muted: "#6c6c6d", surface: "#f0f0f0", border: "#c5c5c6",
  },
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  return "";
}

export function useHighlightedHtml(code: string, lang: string) {
  const { theme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    import("shiki").then(({ codeToHtml }) =>
      codeToHtml(code, {
        lang,
        theme: theme === "light" ? "github-light" : "github-dark",
      }),
    ).then(setHtml);
  }, [code, lang, theme]);

  return html;
}

// ── Components ───────────────────────────────────────────────────────────────

export function MermaidDiagram({ code }: { code: string }) {
  const { theme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(false);

    import("beautiful-mermaid")
      .then(({ renderMermaidSVG }) => {
        if (cancelled) return;
        try {
          const result = renderMermaidSVG(code, {
            ...MERMAID_THEMES[theme],
            font: "Geist, system-ui, sans-serif",
            transparent: true,
            padding: 24,
          });
          setSvg(result);
        } catch {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) {
    return (
      <div className="my-3 rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 px-4 py-6 text-xs text-zinc-500">
        Failed to render diagram
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 px-4 py-6 text-xs text-zinc-500 animate-pulse">
        Loading diagram&hellip;
      </div>
    );
  }

  // Parse SVG dimensions to decide layout
  const widthMatch = svg.match(/width="(\d+(?:\.\d+)?)"/);
  const heightMatch = svg.match(/height="(\d+(?:\.\d+)?)"/);
  const svgWidth = widthMatch ? parseFloat(widthMatch[1]) : 0;
  const svgHeight = heightMatch ? parseFloat(heightMatch[1]) : 0;
  const isWide = svgWidth > 0 && svgHeight > 0 && svgWidth / svgHeight > 2.5;

  return (
    <div
      className={
        isWide
          ? "my-3 overflow-x-auto [&_svg]:h-auto [&_svg]:min-w-[600px]"
          : "my-3 flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
      }
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function CodeBlock({ language, children }: { language: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  const html = useHighlightedHtml(text, language || "text");

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-4 border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/60 border-b border-zinc-800">
        <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
          {language || "code"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {html ? (
        <div
          className="overflow-x-auto px-3 py-3 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_code]:!bg-transparent"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto px-3 py-3 text-[13px] font-mono text-zinc-300 leading-relaxed">
          <code>{children}</code>
        </pre>
      )}
    </div>
  );
}

export const sdComponents = {
  code: ({ className, children, ...rest }: React.ComponentProps<"code"> & { "data-block"?: boolean }) => {
    const isBlock = "data-block" in rest;
    const lang = className?.match(/language-(\S+)/)?.[1] ?? "";

    if (isBlock) {
      if (lang === "mermaid") {
        return <MermaidDiagram code={extractText(children)} />;
      }
      return <CodeBlock language={lang}>{children}</CodeBlock>;
    }

    return (
      <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[13px] font-mono text-viz-7">
        {children}
      </code>
    );
  },
  table: (p: React.ComponentProps<"table">) => (
    <div className="my-4 overflow-x-auto border border-zinc-800 bg-zinc-900/50">
      <table className="w-full text-xs" {...p} />
    </div>
  ),
  thead: (p: React.ComponentProps<"thead">) => (
    <thead className="bg-zinc-800/60" {...p} />
  ),
  th: (p: React.ComponentProps<"th">) => (
    <th
      className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium tracking-wide text-zinc-400 uppercase border-b border-zinc-800"
      {...p}
    />
  ),
  td: (p: React.ComponentProps<"td">) => (
    <td
      className="whitespace-nowrap px-3 py-1.5 text-zinc-300 border-b border-zinc-800/50 tabular-nums"
      {...p}
    />
  ),
  tr: (p: React.ComponentProps<"tr">) => (
    <tr className="hover:bg-zinc-800/30 transition-colors" {...p} />
  ),
};
