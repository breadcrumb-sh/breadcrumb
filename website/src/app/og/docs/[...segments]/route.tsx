import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { BreadcrumbOgCard } from "@/lib/og";
import { source } from "@/lib/source";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  const { segments } = await context.params;
  const slug = segments.at(-1) === "image.png" ? segments.slice(0, -1) : segments;
  const page = source.getPage(slug);

  if (!page) {
    notFound();
  }

  const description =
    page.data.description ?? "Documentation for Breadcrumb and its TypeScript SDKs.";

  return new ImageResponse(
    (
      <BreadcrumbOgCard
        eyebrow="Docs"
        title={page.data.title}
        description={description}
        footer={<span>breadcrumb.sh{page.url}</span>}
      />
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
