import type { NextConfig } from 'next';
import { authCallbackPath, authCallbackSecurityHeaders, securityHeaders } from './lib/securityHeaders.ts';

const nextConfig: NextConfig = {
  // Only the files `node server.js` needs, copied by the Dockerfile (the same deployment shape as apps/web).
  output: 'standalone',
  devIndicators: false,
  poweredByHeader: false,

  async headers() {
    return [
      { source: `/:path((?!${authCallbackPath}(?:/|$)).*)`, headers: [...securityHeaders] },
      { source: `/${authCallbackPath}`, headers: [...authCallbackSecurityHeaders] },
    ];
  },
};

export default nextConfig;
