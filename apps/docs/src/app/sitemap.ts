import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: `https://breadcrumb.sh/docs/${page.slugs.join('/')}`,
    lastModified: new Date(),
  }));
}
