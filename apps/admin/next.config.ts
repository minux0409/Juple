import type { NextConfig } from 'next';
import { authCallbackPath, authCallbackSecurityHeaders, securityHeaders, staticAssetSecurityHeaders } from './lib/securityHeaders.ts';

const nextConfig: NextConfig = {
  // Only the files `node server.js` needs, copied by the Dockerfile (the same deployment shape as apps/web).
  output: 'standalone',
  devIndicators: false,
  poweredByHeader: false,

  async headers() {
    return [
      { source: `/:path((?!${authCallbackPath}(?:/|$)|_next/static(?:/|$)).*)`, headers: [...securityHeaders] },
      { source: `/${authCallbackPath}`, headers: [...authCallbackSecurityHeaders] },
      { source: '/_next/static/:path*', headers: [...staticAssetSecurityHeaders] },
    ];
  },
};

export default nextConfig;
