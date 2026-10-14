import { NextResponse, type NextRequest } from 'next/server';
import { isPublicOnly, routePublicOnly } from './lib/publicOnly';

/**
 * Public-only launch mode (lib/publicOnly.ts). Off - the default - it changes nothing. On, "/" shows the public landing page and
 * anything outside the public allow-list is a 404, before any signed-in page is rendered.
 */
export function proxy(request: NextRequest) {
  if (!isPublicOnly()) {
    return NextResponse.next();
  }
  const route = routePublicOnly(request.nextUrl.pathname);
  return route.kind === 'serve' ? NextResponse.next() : NextResponse.rewrite(new URL(route.path, request.url));
}

export const config = {
  // Every path except Next's own build assets (scripts, styles, optimized images).
  matcher: ['/((?!_next/).*)'],
};
