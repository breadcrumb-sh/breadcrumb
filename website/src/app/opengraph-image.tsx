import { ImageResponse } from "next/og";
import { BreadcrumbOgCard } from "@/lib/og";

export const alt = "Breadcrumb";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <BreadcrumbOgCard
        eyebrow="Home"
        title="Simple, self-hosted LLM observability for TypeScript"
        description="Trace every prompt, completion, token count, latency, and cost. Open source and self-hostable."
        footer={<span>breadcrumb.sh</span>}
      />
    ),
    size,
  );
}
