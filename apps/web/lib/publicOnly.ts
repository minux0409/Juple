/**
 * Public-only launch mode: JUPLE_WEB_PUBLIC_ONLY=true (a plain runtime variable, read per request). For a release that ships the
 * mobile app without the signed-in Web app (Android-first): the site serves ONLY its public parts - a landing page at "/", the legal
 * pages, the shared-Collection viewer, the app-link verification files and their static assets. Every other path (the signed-in app,
 * its sign-in bridge, anything new) is a plain 404, so no sign-in button or "sign-in is not configured" screen can ever be reached.
 * It is an allow-list on purpose: a page added later stays private to the signed-in build until it is listed here.
 *
 * Unset or anything but "true": the full site, exactly as before (Dev's signed-in Web is unaffected).
 */
export const PUBLIC_ONLY_ENV = 'JUPLE_WEB_PUBLIC_ONLY';

/** The public landing page "/" is served from in public-only mode (its own route, outside the signed-in app). */
export const PUBLIC_LANDING_PATH = '/welcome';

/**
 * The route that only answers notFound() (app/public-only-not-found): the site's own 404 page with a 404 status. Not merely "a path
 * that matches nothing" - the signed-in app's parallel @modal/[...catchAll] slot would claim such a path and render the app shell.
 */
export const PUBLIC_ONLY_NOT_FOUND_PATH = '/public-only-not-found';

const PUBLIC_EXACT_PATHS = new Set([
  PUBLIC_LANDING_PATH,
  '/privacy',
  '/terms',
  '/account-deletion',
  '/robots.txt',
  '/icon.png',
  '/apple-icon.png',
  '/favicon.ico',
]);

const PUBLIC_PATH_PREFIXES = ['/c/', '/.well-known/', '/brand/'];

export function isPublicOnly(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[PUBLIC_ONLY_ENV]?.trim().toLowerCase() === 'true';
}

export type PublicOnlyRoute = { readonly kind: 'serve' } | { readonly kind: 'rewrite'; readonly path: string };

/** What public-only mode does with a request path (Next's own /_next assets never reach this - see proxy.ts's matcher). */
export function routePublicOnly(pathname: string): PublicOnlyRoute {
  if (pathname === '/') {
    return { kind: 'rewrite', path: PUBLIC_LANDING_PATH };
  }
  if (PUBLIC_EXACT_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return { kind: 'serve' };
  }
  return { kind: 'rewrite', path: PUBLIC_ONLY_NOT_FOUND_PATH };
}
