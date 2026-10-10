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
];

/** The public legal pages (/privacy, /terms, /account-deletion) are meant to be found, so they get every header above EXCEPT the noindex one. */
export const legalSecurityHeaders: readonly { readonly key: string; readonly value: string }[] = securityHeaders.filter(
  header => header.key !== 'X-Robots-Tag',
);

/** Paths of the public legal pages, as a path-to-regexp group usable in next.config's header sources. */
export const legalPages = ['privacy', 'terms', 'account-deletion'] as const;
export const legalPathGroup = legalPages.join('|');
