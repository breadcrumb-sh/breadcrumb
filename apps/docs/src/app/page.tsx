import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { TimelineAnimation } from "./timeline-animation";

export const metadata: Metadata = {
  title: "Simple, Open-Source LLM Tracing",
  description:
    "Like Plausible, but for your AI agents. Self-hostable, TypeScript-native LLM tracing - track every prompt, completion, token count, and cost.",
  openGraph: {
    images: "/opengraph-image",
  },
  twitter: {
    images: ["/opengraph-image"],
  },
};

const codeSnippet = `<span style="color:#c792ea">import</span> { init } <span style="color:#c792ea">from</span> <span style="color:#E77270">"@breadcrumb-sdk/core"</span>;
<span style="color:#c792ea">import</span> { initAiSdk } <span style="color:#c792ea">from</span> <span style="color:#E77270">"@breadcrumb-sdk/ai-sdk"</span>;

<span style="color:#82aaff">const</span> bc = init({ apiKey, baseUrl });
<span style="color:#82aaff">const</span> { telemetry } = initAiSdk(bc);

<span style="color:#82aaff">const</span> { text } = <span style="color:#c792ea">await</span> generateText({
  <span style="color:#6c6c6d">// ...</span>
  experimental_telemetry: telemetry(<span style="color:#E77270">"summarize"</span>),
});`;

function Logo({ size = 26 }: { size?: number }) {
  return (
    <img src="/bread_icon.svg" alt="" width={size} height={size} aria-hidden="true" />
  );
}

export default function Home() {
  return (
    <>
      <main>
        <nav>
          <div className="marketing-inner flex h-24 items-center justify-between">
            <div className="flex items-center gap-7">
              <Link href="/" className="flex items-center gap-2">
                <Logo />
                <span className="font-display text-[16px] font-semibold tracking-tight text-fg">
                  Breadcrumb
                </span>
                <span className="ml-1 flex h-5 items-center border border-dashed border-white/50 px-1.5 font-display text-[12px] leading-3 tracking-tight text-white/50">
                  Beta
                </span>
              </Link>
            </div>
            <div className="flex flex-row items-center gap-8">
              <Link
                href="/docs/introduction"
                className="font-display text-[13px] font-medium text-fg-3 transition-colors hover:text-fg"
              >
                Docs
              </Link>
            </div>
          </div>
        </nav>

        <section className="border-b border-border">
          <div className="marketing-inner pb-14 pt-14 sm:pb-20 sm:pt-20">
            <h1 className="mb-5 max-w-4xl text-balance font-display text-[clamp(32px,5vw,58px)] leading-[1.04] font-semibold tracking-[-0.03em] text-fg">
              Open-source LLM tracing for agent visibility
            </h1>
            <p className="mb-8 max-w-[430px] text-[14px] leading-[1.75] text-fg-2 sm:text-[15px]">
              Like Plausible, but for your AI agents. Self-hostable, TypeScript-native,
              and built to explore your traces, not just store them.
            </p>
            <div className="flex w-full gap-3 sm:w-auto">
              <a
                href="https://tally.so/r/A7xjRB"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 shrink-0 items-center justify-center gap-3 whitespace-nowrap bg-fg px-12 py-3 font-display text-[13px] font-semibold text-bg transition-opacity hover:opacity-80 sm:flex-initial"
              >
                Get Early Access
              </a>
              <a
                href="https://demo.breadcrumb.sh"
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-1 shrink-0 items-center justify-center gap-3 whitespace-nowrap border border-current px-14 py-3 font-display text-[13px] font-semibold text-fg-2 transition-colors hover:text-fg sm:flex-initial"
              >
                Try demo
              </a>
            </div>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="marketing-inner">
            <div className="border-x border-border">
              <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-[6px] w-[6px]">
                    <span className="live-ping absolute inset-0 rounded-full bg-[#22c08b] opacity-40" />
                    <span className="relative h-[6px] w-[6px] rounded-full bg-[#22c08b]" />
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-fg-3">
                    traces - live
                  </span>
                </div>
                <div className="flex gap-[5px]">
                  <span className="block h-[6px] w-[6px] bg-[#58508d]" />
                  <span className="block h-[6px] w-[6px] bg-[#b4558d]" />
                  <span className="block h-[6px] w-[6px] bg-[#e77371]" />
                  <span className="block h-[6px] w-[6px] bg-[#7b6aad]" />
                </div>
              </div>
              <div className="px-4 pb-6 pt-5 sm:px-5">
                <div className="mb-[10px] flex justify-between">
                  <span className="font-mono text-[9px] text-fg-3 opacity-40">0</span>
                  <span className="hidden font-mono text-[9px] text-fg-3 opacity-40 sm:block">
                    250ms
                  </span>
                  <span className="font-mono text-[9px] text-fg-3 opacity-40">500ms</span>
                  <span className="hidden font-mono text-[9px] text-fg-3 opacity-40 sm:block">
                    750ms
                  </span>
                  <span className="font-mono text-[9px] text-fg-3 opacity-40">1s+</span>
                </div>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-0 flex" aria-hidden="true">
                    <div className="h-full w-1/4 border-r border-border" />
                    <div className="h-full w-1/4 border-r border-border" />
                    <div className="h-full w-1/4 border-r border-border" />
                    <div className="h-full w-1/4" />
                  </div>
                  <div id="tl-rows" className="relative flex flex-col gap-[10px] sm:gap-[13px]" />
                  <TimelineAnimation />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="marketing-inner py-10 sm:py-12">
            <h2 className="mb-3 font-display text-[22px] leading-snug font-semibold tracking-tight text-fg sm:text-[27px]">
              Three lines of code. Every call traced.
            </h2>
            <p className="max-w-[420px] text-[13px] leading-[1.8] text-fg-2 sm:text-[14px]">
              Initialize the SDK, pass the telemetry helper. No config files, no decorators,
              no 30-page setup guide. Your first trace shows up in no time.
            </p>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="marketing-inner pt-8 sm:pt-12">
            <div className="marketing-browser">
              <div className="marketing-browser-toolbar">
                <div className="marketing-browser-dots">
                  <span className="marketing-browser-dot bg-[#ff5f57]" />
                  <span className="marketing-browser-dot bg-[#febc2e]" />
                  <span className="marketing-browser-dot bg-[#28c840]" />
                </div>
                <div className="marketing-browser-address">
                  <span className="font-mono text-[10px] text-fg-3">app.breadcrumb.sh</span>
                </div>
                <div className="marketing-browser-dots invisible">
                  <span className="marketing-browser-dot" />
                  <span className="marketing-browser-dot" />
                  <span className="marketing-browser-dot" />
                </div>
              </div>
              <div className="marketing-browser-content">
                <Image
                  src="/dashboard.png"
                  alt="Breadcrumb LLM tracing dashboard showing traces, token counts, latency, and costs"
                  width={2062}
                  height={1434}
                  priority={false}
                  className="block w-full"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="marketing-inner py-10 sm:py-12">
            <h2 className="mb-3 font-display text-[22px] leading-snug font-semibold tracking-tight text-fg sm:text-[27px]">
              Know exactly what your AI is doing.
            </h2>
            <p className="max-w-[400px] text-[13px] leading-[1.8] text-fg-2 sm:text-[14px]">
              See the actual prompt that was sent, the full response that came back, how
              long it took, and what it cost. For every request, not a sample.
            </p>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="marketing-inner">
            <div className="grid grid-cols-1 gap-px border-x border-border bg-border sm:grid-cols-3">
              <div className="flex flex-col justify-between gap-8 bg-surface p-6 sm:p-8">
                <span className="font-mono text-[10px] uppercase tracking-widest text-fg-3">
                  cost per trace
                </span>
                <div>
                  <div className="mb-3 font-mono text-[40px] leading-none font-light tracking-tight text-fg">
                    $0.0024
                  </div>
                  <p className="text-[13px] leading-[1.75] text-fg-2">
                    Every trace breaks down its token usage and cost. Find the calls burning
                    through your budget before they hit your invoice.
                  </p>
                </div>
              </div>

              <div className="col-span-1 flex flex-col justify-between gap-8 bg-surface p-6 sm:col-span-2 sm:p-8">
                <span className="font-mono text-[10px] uppercase tracking-widest text-fg-3">
                  open source
                </span>
                <div>
                  <p className="mb-2 font-display text-[17px] leading-snug font-semibold text-fg">
                    Your data never leaves your stack.
                  </p>
                  <p className="mb-4 max-w-[400px] text-[13px] leading-[1.75] text-fg-2">
                    Deploy on Railway, Fly, or your own servers. Fork it, extend it, run it
                    however you want. No usage fees, no vendor lock-in, open source forever.
                  </p>
                  <a
                    href="https://github.com/joshuaKnauber/breadcrumb"
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10px] text-fg-3 transition-colors hover:text-fg"
                  >
                    ★ github.com/joshuaKnauber/breadcrumb
                  </a>
                </div>
              </div>

              <div className="col-span-1 flex flex-col gap-6 bg-surface p-6 sm:col-span-3 sm:p-8">
                <span className="font-mono text-[10px] uppercase tracking-widest text-fg-3">
                  integration
                </span>
                <div className="flex flex-col gap-6">
                  <div>
                    <p className="mb-2 font-display text-[17px] leading-snug font-semibold text-fg">
                      Works with the Vercel AI SDK out of the box
                    </p>
                    <p className="max-w-[480px] text-[13px] leading-[1.75] text-fg-2">
                      Add two imports, initialize once, and pass the telemetry helper. Every{" "}
                      <code className="text-fg-3">generateText</code> and{" "}
                      <code className="text-fg-3">streamText</code> call gets traced
                      automatically.
                    </p>
                  </div>
                  <pre className="overflow-x-auto border border-border bg-bg p-4 font-mono text-[12px] leading-[1.7] text-fg-2 sm:text-[13px]">
                    <code dangerouslySetInnerHTML={{ __html: codeSnippet }} />
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="marketing-inner py-12 sm:py-16">
            <h2 className="mb-3 font-display text-[22px] leading-snug font-semibold tracking-tight text-fg sm:text-[28px]">
              Start tracing in minutes.
            </h2>
            <p className="mb-7 max-w-[340px] text-[13px] leading-[1.75] text-fg-2">
              Install the SDK, add three lines, and see your first trace.
            </p>
            <div className="flex flex-row gap-4 h-fit">
              <Link
                href="/docs/introduction"
                className="items-center gap-3 bg-fg px-12 whitespace-nowrap justify-center flex font-display text-[13px] font-semibold text-bg transition-opacity hover:opacity-80"
              >
                Read the docs
              </Link>
              <a target="_blank" href="https://railway.com/deploy/breadcrumb?referralCode=9MtPO4&utm_medium=integration&utm_source=template&utm_campaign=generic">
                <img src="https://railway.com/button.svg"></img>
              </a>
            </div>
          </div>
        </section>

        <footer>
          <div className="marketing-inner flex items-center justify-between py-6">
            <Link
              href="/"
              className="flex items-center gap-2 font-display text-[12px] leading-3 font-medium text-fg-3 transition-colors hover:text-fg"
            >
              <Logo size={14} />
              Breadcrumb
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/docs/introduction"
                className="font-display text-[13px] font-medium text-fg-3 transition-colors hover:text-fg"
              >
                Docs
              </Link>
              <a
                href="https://x.com/joshuaKnauber"
                target="_blank"
                rel="noreferrer"
                className="text-fg-3 transition-colors hover:text-fg"
                aria-label="X"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://github.com/joshuaKnauber/breadcrumb"
                target="_blank"
                rel="noreferrer"
                className="text-fg-3 transition-colors hover:text-fg"
                aria-label="GitHub"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
              <p className="text-xs text-fg-3">&copy; {new Date().getFullYear()} Breadcrumb</p>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
