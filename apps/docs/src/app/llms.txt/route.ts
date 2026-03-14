import { source } from '@/lib/source';

export const dynamic = 'force-static';

export async function GET() {
  const pages = source.getPages();

  const index = pages
    .map((page) => {
      return `- [${page.data.title}](/docs/${page.slugs.join('/')})${page.data.description ? `: ${page.data.description}` : ''}`;
    })
    .join('\n');

  const content = `# Breadcrumb

> Open-source LLM tracing for TypeScript.

Breadcrumb is an open-source tracing platform for LLM applications. It captures every model call your app makes - prompts, completions, tokens, latency, and cost.

## Docs

${index}
`;

  return new Response(content);
}
