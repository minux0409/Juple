import type { NextConfig } from 'next';
import { authCallbackPath, authCallbackSecurityHeaders, legalPages, legalPathGroup, legalSecurityHeaders, securityHeaders } from './lib/securityHeaders.ts';

const nextConfig: NextConfig = {
  // Server Components render server-side (no client bundle secret exposure), but the "load more"
  // pagination below is a Client Component that must call the Public API directly from the
  // browser - see PUBLIC_API_BASE_URL in lib/publicApi.ts for why NEXT_PUBLIC_ is required there.

  // Traces only the files `next start`'s server actually needs into `.next/standalone` (see
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md) -
  // the production Docker image (see Dockerfile) copies just that output, not the full
  // node_modules/Next.js compiler.
  output: 'standalone',

  // The Next.js development indicator (the round 'N' badge, development only) is not Juple UI - hidden. Compile / runtime errors are still
  // shown in development (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/devIndicators.md); no effect on production.
  devIndicators: false,

  async headers() {
    return [
      // Everything is link-only and noindex, except the public legal pages (Google Play needs to open and index them) and the
      // MSAL redirect bridge (same headers, but frameable by this origin for silent token renewal - see securityHeaders.ts).
      { source: `/:path((?!(?:${legalPathGroup}|${authCallbackPath})(?:/|$)).*)`, headers: [...securityHeaders] },
      ...legalPages.map(page => ({ source: `/${page}`, headers: [...legalSecurityHeaders] })),
      { source: `/${authCallbackPath}`, headers: [...authCallbackSecurityHeaders] },
    ];
  },
};

export default nextConfig;
