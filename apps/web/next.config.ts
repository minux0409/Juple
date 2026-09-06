import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Server Components render server-side (no client bundle secret exposure), but the "load more"
  // pagination below is a Client Component that must call the Public API directly from the
  // browser - see PUBLIC_API_BASE_URL in lib/publicApi.ts for why NEXT_PUBLIC_ is required there.
};

export default nextConfig;
