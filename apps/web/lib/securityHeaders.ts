/**
 * Response headers for every page of the public viewer. The page is link-only content: never framed, never indexed, and it sends
 * no Referer (the share id is in the URL path). The CSP is deliberately limited to the directives that cannot break Next.js's own
 * inline bootstrap scripts.
 */
export const securityHeaders: readonly { readonly key: string; readonly value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  // HTTPS only, for this exact host (no includeSubDomains / preload: the apex and api. are separate services with their own certificates).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

/** The public legal pages (/privacy, /terms, /account-deletion) are meant to be found, so they get every header above EXCEPT the noindex one. */
export const legalSecurityHeaders: readonly { readonly key: string; readonly value: string }[] = securityHeaders.filter(
  header => header.key !== 'X-Robots-Tag',
);

/**
 * The MSAL redirect bridge (/auth/callback). Same headers, except it may be framed by THIS origin only: MSAL's silent token renewal
 * loads it in a hidden same-origin iframe to hand the response back to the app. Still never framed by any other site.
 */
export const authCallbackSecurityHeaders: readonly { readonly key: string; readonly value: string }[] = securityHeaders.map(header => {
  if (header.key === 'X-Frame-Options') {
    return { key: header.key, value: 'SAMEORIGIN' };
  }
  if (header.key === 'Content-Security-Policy') {
    return { key: header.key, value: header.value.replace("frame-ancestors 'none'", "frame-ancestors 'self'") };
  }
  return header;
});

/** The redirect bridge's path, excluded from the default headers in next.config (it gets authCallbackSecurityHeaders instead). */
export const authCallbackPath = 'auth/callback';

/** Paths of the public legal pages, as a path-to-regexp group usable in next.config's header sources. */
export const legalPages = ['privacy', 'terms', 'account-deletion'] as const;
export const legalPathGroup = legalPages.join('|');
