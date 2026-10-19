import { NextResponse, type NextRequest } from 'next/server';
import { adminEnvFromProcess, readAdminConfig } from './lib/adminConfig';
import { authCallbackPath, contentSecurityPolicy } from './lib/securityHeaders';

/** Adds the Content-Security-Policy, whose connect-src comes from the RUNTIME configuration (one image for every environment). */
export function proxy(request: NextRequest) {
  const result = readAdminConfig(adminEnvFromProcess());
  const isAuthCallback = request.nextUrl.pathname.replace(/\/+$/, '') === `/${authCallbackPath}`;
  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', contentSecurityPolicy(result.ok ? result.config : null, isAuthCallback));
  return response;
}

export const config = {
  // Every path except Next's own build assets.
  matcher: ['/((?!_next/).*)'],
};
