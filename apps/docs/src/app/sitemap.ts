import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

const BASE_URL = "https://breadcrumb.sh";

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((page) => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: new Date(),
  }));

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
    },
    ...docs,
  ];
}
