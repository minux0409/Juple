import type { MetadataRoute } from 'next';

// The Public Web Viewer is link-only access (see docs/product-overview.md's trust principles) -
// it must never be crawled or show up in search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
