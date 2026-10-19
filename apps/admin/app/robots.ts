import type { MetadataRoute } from 'next';

// Nothing on the Admin Web may be crawled.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
