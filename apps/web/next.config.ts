import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Server Components render server-side (no client bundle secret exposure), but the "load more"
  // pagination below is a Client Component that must call the Public API directly from the
  // browser - see PUBLIC_API_BASE_URL in lib/publicApi.ts for why NEXT_PUBLIC_ is required there.

  // Traces only the files `next start`'s server actually needs into `.next/standalone` (see
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md) -
  // the production Docker image (see Dockerfile) copies just that output, not the full
  // node_modules/Next.js compiler.
  output: 'standalone',
};

export default nextConfig;
