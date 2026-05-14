import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Open-source LLM tracing that catches what dashboards can't",
  description:
    "AI-powered monitoring for your agents. Breadcrumb traces every LLM call and runs an agent that finds hallucination, context loss, and reasoning drift automatically.",
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
          <div className="marketing-inner flex h-16 items-center justify-between sm:h-24">
            <div className="flex items-center gap-7">
              <Link href="/" className="flex items-center gap-2">
                <Logo size={24} />
                <span className="font-display text-[16px] font-semibold tracking-tight text-fg">
                  Breadcrumb
                </span>
                <span className="ml-1 font-display text-[12px] text-fg-3">
                  Beta
                </span>
              </Link>
            </div>
            <div className="flex flex-row items-center gap-4 sm:gap-8">
              <Link
                href="/docs/introduction"
                className="font-display text-[13px] font-medium text-fg-3 transition-colors hover:text-fg"
              >
                Docs
              </Link>
              <a
                href="https://www.producthunt.com/products/breadcrumb-2?utm_source=badge-follow&utm_medium=badge&utm_source=badge-breadcrumb-2"
                target="_blank"
                rel="noopener noreferrer"
                className="sm:hidden"
              >
                <img
                  src="https://api.producthunt.com/widgets/embed-image/v1/follow.svg?product_id=1189959&theme=dark&size=small"
                  alt="Breadcrumb - Open-source LLM tracing for agent visibility | Product Hunt"
                  width="86"
                  height="32"
                />
              </a>
              <a
                href="https://www.producthunt.com/products/breadcrumb-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-breadcrumb-3"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:block"
              >
                <img
                  src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1107414&theme=dark&t=1774619256689"
                  alt="Breadcrumb - Open-source LLM tracing for agent visibility | Product Hunt"
                  width="250"
                  height="54"
                  className="h-9 w-auto"
                />
              </a>
            </div>
          </div>
        </nav>

        <section className="relative z-10">
          <div className="marketing-inner pt-14 sm:pt-28">
            <h1 className="motion-blur-in-sm motion-duration-1000 mb-6 sm:mb-5 max-w-4xl text-balance font-display text-[clamp(32px,5vw,58px)] leading-[1.04] font-semibold tracking-[-0.03em] text-fg">
              Open-source LLM tracing that catches what dashboards can't
            </h1>
            <p className="motion-blur-in-sm motion-duration-1000 motion-delay-500 mb-8 max-w-[620px] text-balance text-[14px] leading-[1.5] text-fg-2 sm:text-[15px]">
              Your agent returned a confident wrong answer. The error rate stayed at zero. Breadcrumb catches these issues before your users do.
            </p>
            <div className="motion-blur-in-sm motion-duration-1000 motion-delay-700 flex w-full gap-3 sm:w-auto">
              <a
                href="https://tally.so/r/A7xjRB"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-3 whitespace-nowrap rounded-[2px] bg-fg px-8 py-3 font-display text-[13px] font-semibold text-bg transition-opacity hover:opacity-80 sm:flex-initial sm:px-12"
              >
                Get Early Access
              </a>
              <a
                href="https://demo.breadcrumb.sh"
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-3 whitespace-nowrap rounded-[2px] border border-current px-8 py-3 font-display text-[13px] font-semibold text-fg-2 transition-colors hover:text-fg sm:flex-initial sm:px-14"
              >
                Try the Demo
              </a>
            </div>
          </div>
        </section>

        <section className="hero-screenshot-section relative">
          <div className="hero-screenshot-gradient" />
          <div className="hero-screenshot-wrapper">
            <div className="hero-screenshot-container motion-translate-y-in-[30px] motion-opacity-in-0 motion-blur-in-sm motion-duration-1000 motion-delay-700">
              <div className="hero-img-wrap">
                <img
                  src="/dashboard.webp"
                  alt="Breadcrumb LLM tracing dashboard showing traces, token counts, latency, and costs"
                  className="hero-img-sharp"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Agent Monitor Section */}
        <section className="relative z-10 border-b border-border bg-bg">
          <div className="marketing-inner py-14 sm:py-20">
            <div className="mb-10 sm:mb-14">
              <h2 className="mb-3 text-balance font-display text-[22px] leading-snug font-semibold tracking-tight text-fg sm:text-[27px]">
                Issues found before your users find them.
              </h2>
              <p className="max-w-[560px] text-balance text-[13px] leading-[1.6] text-fg-2 sm:text-[14px]">
                A monitoring agent that reads every trace, learns your project, and surfaces what matters.
              </p>
            </div>

            <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
              {/* Card 1: Queue */}
              <div className="flex flex-1 flex-col">
                <div className="monitor-card">
                  <div className="flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-fg-3">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
                    </svg>
                    <span className="text-[11px] text-fg-3">Auto-detected</span>
                  </div>
                  <p className="text-[13px] font-medium leading-snug text-fg">
                    Search agent returning confident answers from empty context window
                  </p>
                  <div className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-orange-400">
                      <rect x="1" y="10" width="3" height="5" rx="0.5" opacity="1" />
                      <rect x="6" y="6" width="3" height="9" rx="0.5" opacity="1" />
                      <rect x="11" y="2" width="3" height="13" rx="0.5" opacity="0.2" />
                    </svg>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2/50 px-1.5 py-0.5 text-[10px] leading-none text-fg-3">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      hallucination
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Investigating (processing animation) */}
              <div className="flex flex-1 flex-col">
                <div className="monitor-card-processing">
                  <div className="monitor-card-processing-border" />
                  <div className="monitor-card-processing-inner">
                    <div className="flex items-center gap-1.5">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-amber-400">
                        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M8 8 L8 4 A4 4 0 0 1 12 8 Z" fill="currentColor" />
                      </svg>
                      <span className="text-[11px] text-amber-400">Investigating</span>
                    </div>
                    <p className="text-[13px] font-medium leading-snug text-fg">
                      Retrieval agent skipping 40% of available documents in summarize workflow
                    </p>
                    <div className="flex items-center gap-2">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-amber-400">
                        <rect x="1" y="10" width="3" height="5" rx="0.5" opacity="1" />
                        <rect x="6" y="6" width="3" height="9" rx="0.5" opacity="0.2" />
                        <rect x="11" y="2" width="3" height="13" rx="0.5" opacity="0.2" />
                      </svg>
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2/50 px-1.5 py-0.5 text-[10px] leading-none text-fg-3">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        context loss
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Needs Review */}
              <div className="flex flex-1 flex-col">
                <div className="monitor-card">
                  <div className="flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-blue-400">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M8 8 L8 4 A4 4 0 1 1 4.536 10 L8 8 Z" fill="currentColor" />
                    </svg>
                    <span className="text-[11px] text-blue-400">Needs review</span>
                  </div>
                  <p className="text-[13px] font-medium leading-snug text-fg">
                    Cost spike: generateText calls doubled token usage after prompt template change
                  </p>
                  <div className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-red-400">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <text x="8" y="12" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">!</text>
                    </svg>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2/50 px-1.5 py-0.5 text-[10px] leading-none text-fg-3">
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                      cost
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What it understands */}
        <section className="border-b border-border">
          <div className="marketing-inner py-14 sm:py-20">
            <h2 className="mb-3 text-balance font-display text-[22px] leading-snug font-semibold tracking-tight text-fg sm:text-[27px]">
              Other tools log your traces. Breadcrumb understands them.
            </h2>
            <p className="mb-10 max-w-[560px] text-balance text-[13px] leading-[1.6] text-fg-2 sm:mb-14 sm:text-[14px]">
              Every other tracing tool expects you to find the problems yourself. Breadcrumb's agent reads every trace, builds context over time, and gets smarter about what matters in your project.
            </p>
            <div className="findings-ticker-wrap">
              <div className="findings-ticker">
                <div className="findings-ticker-track">
                  <div className="findings-row">
                    <span className="findings-dot bg-red-400" />
                    <span className="findings-label">hallucination</span>
                    <span className="findings-text">Agent cited policy doc not in retrieval set</span>
                    <span className="findings-time">2m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-blue-400" />
                    <span className="findings-label">intent mismatch</span>
                    <span className="findings-text">Responded about order #4812 instead of #4821</span>
                    <span className="findings-time">5m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-amber-400" />
                    <span className="findings-label">context loss</span>
                    <span className="findings-text">Dropped 3 of 7 source documents after tool call</span>
                    <span className="findings-time">8m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-orange-400" />
                    <span className="findings-label">loop detected</span>
                    <span className="findings-text">Same failing tool call retried 4 times then abandoned</span>
                    <span className="findings-time">12m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-violet-400" />
                    <span className="findings-label">cost anomaly</span>
                    <span className="findings-text">Token usage doubled across generateText after template change</span>
                    <span className="findings-time">19m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-pink-400" />
                    <span className="findings-label">instruction drift</span>
                    <span className="findings-text">Correct answer but ignored user constraint on format</span>
                    <span className="findings-time">23m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-red-400" />
                    <span className="findings-label">hallucination</span>
                    <span className="findings-text">Generated citation for a paper that doesn't exist</span>
                    <span className="findings-time">31m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-amber-400" />
                    <span className="findings-label">context loss</span>
                    <span className="findings-text">User name forgotten mid-conversation after tool use</span>
                    <span className="findings-time">38m ago</span>
                  </div>
                  {/* Duplicate for seamless loop */}
                  <div className="findings-row">
                    <span className="findings-dot bg-red-400" />
                    <span className="findings-label">hallucination</span>
                    <span className="findings-text">Agent cited policy doc not in retrieval set</span>
                    <span className="findings-time">2m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-blue-400" />
                    <span className="findings-label">intent mismatch</span>
                    <span className="findings-text">Responded about order #4812 instead of #4821</span>
                    <span className="findings-time">5m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-amber-400" />
                    <span className="findings-label">context loss</span>
                    <span className="findings-text">Dropped 3 of 7 source documents after tool call</span>
                    <span className="findings-time">8m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-orange-400" />
                    <span className="findings-label">loop detected</span>
                    <span className="findings-text">Same failing tool call retried 4 times then abandoned</span>
                    <span className="findings-time">12m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-violet-400" />
                    <span className="findings-label">cost anomaly</span>
                    <span className="findings-text">Token usage doubled across generateText after template change</span>
                    <span className="findings-time">19m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-pink-400" />
                    <span className="findings-label">instruction drift</span>
                    <span className="findings-text">Correct answer but ignored user constraint on format</span>
                    <span className="findings-time">23m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-red-400" />
                    <span className="findings-label">hallucination</span>
                    <span className="findings-text">Generated citation for a paper that doesn't exist</span>
                    <span className="findings-time">31m ago</span>
                  </div>
                  <div className="findings-row">
                    <span className="findings-dot bg-amber-400" />
                    <span className="findings-label">context loss</span>
                    <span className="findings-text">User name forgotten mid-conversation after tool use</span>
                    <span className="findings-time">38m ago</span>
                  </div>
                </div>
              </div>
              <div className="findings-fade-top" />
              <div className="findings-fade-bottom" />
            </div>
          </div>
        </section>

        {/* SDK integration */}
        <section className="border-b border-border">
          <div className="marketing-inner py-14 sm:py-20">
            <h2 className="mb-3 text-balance font-display text-[22px] leading-snug font-semibold tracking-tight text-fg sm:text-[27px]">
              Three lines of code. Never miss an issue.
            </h2>
            <p className="mb-8 max-w-[560px] text-balance text-[13px] leading-[1.6] text-fg-2 sm:text-[14px]">
              Works with Vercel AI SDK out of the box. Import, initialize, pass telemetry, stay informed.
            </p>
            <pre className="overflow-x-auto border border-border bg-surface p-4 font-mono text-[12px] leading-[1.7] text-fg-2 sm:text-[13px]">
              <code dangerouslySetInnerHTML={{ __html: codeSnippet }} />
            </pre>
          </div>
        </section>

        {/* Open source + CTA */}
        <section className="border-b border-border">
          <div className="marketing-inner py-14 sm:py-20">
            <h2 className="mb-3 text-balance font-display text-[22px] leading-snug font-semibold tracking-tight text-fg sm:text-[27px]">
              Open source. Self-hosted. Your data.
            </h2>
            <p className="mb-7 max-w-[560px] text-balance text-[13px] leading-[1.6] text-fg-2 sm:text-[14px]">
              Deploy on Railway, Fly, or your own servers. Fork it, extend it, run it
              however you want. No usage fees, no vendor lock-in.
            </p>
            <div className="flex flex-row items-center gap-4 h-fit">
              <a
                href="https://tally.so/r/A7xjRB"
                target="_blank"
                rel="noopener noreferrer"
                className="items-center gap-3 rounded-[2px] bg-fg px-12 py-2.5 whitespace-nowrap justify-center flex font-display text-[13px] font-semibold text-bg transition-opacity hover:opacity-80"
              >
                Get Early Access
              </a>
              <a target="_blank" href="https://railway.com/deploy/breadcrumb?referralCode=9MtPO4&utm_medium=integration&utm_source=template&utm_campaign=generic">
                <img src="https://railway.com/button.svg" />
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
