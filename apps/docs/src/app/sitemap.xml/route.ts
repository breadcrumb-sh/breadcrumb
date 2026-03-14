import { source } from '@/lib/source';

export const dynamic = 'force-static';

export async function GET() {
  const pages = source.getPages();

  const urls = pages
    .map((page) => {
      return `  <url>
    <loc>https://breadcrumb.sh/docs/${page.slugs.join('/')}</loc>
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
