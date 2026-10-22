import { knownAuthorityHosts, type AdminConfig } from './adminConfig.ts';

type Header = { readonly key: string; readonly value: string };

/**
 * Headers for every Admin Web response (next.config.ts). An operator tool: never framed, never indexed, no Referer, no browser
 * features, HTTPS only. HTML and authenticated responses are never cached. The Content-Security-Policy is added per request by proxy.ts (contentSecurityPolicy below)
 * because its connect-src depends on the runtime API / sign-in hosts.
 */
export const securityHeaders: readonly Header[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  // Only this exact host (no includeSubDomains / preload: the apex, api. and admin. are separate services).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  // Nothing an admin sees may be kept by a shared proxy or the browser's back/forward cache.
  { key: 'Cache-Control', value: 'no-store' },
];

/** The MSAL redirect bridge's path; it may be framed by THIS origin only (silent token renewal uses a hidden same-origin iframe). */
export const authCallbackPath = 'auth/callback';

export const authCallbackSecurityHeaders: readonly Header[] = securityHeaders.map(header =>
  header.key === 'X-Frame-Options' ? { key: header.key, value: 'SAMEORIGIN' } : header,
);

// Only Next's versioned build assets: leave Cache-Control to Next so immutable JS/CSS can be reused across visits.
// No admin data or authentication responses are served from /_next/static/. Keep the other security headers.
export const staticAssetSecurityHeaders: readonly Header[] = securityHeaders.filter(header => header.key !== 'Cache-Control');

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The CSP for one response. connect-src allows only this origin, the Juple API and the Entra sign-in hosts - an injected script could
 * not send a token anywhere else. script-src is deliberately not restricted (Next.js's inline bootstrap would break without nonces).
 * Without a configuration (the "not configured" page) nothing but this origin may be contacted.
 */
export function contentSecurityPolicy(config: AdminConfig | null, isAuthCallback: boolean): string {
  const connect = new Set<string>(["'self'"]);
  if (config) {
    const api = origin(config.apiBaseUrl);
    if (api) {
      connect.add(api);
    }
    for (const host of knownAuthorityHosts(config)) {
      connect.add(`https://${host}`);
    }
  }
  return [
    `frame-ancestors ${isAuthCallback ? "'self'" : "'none'"}`,
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `connect-src ${[...connect].join(' ')}`,
    "img-src 'self' data:",
  ].join('; ');
}
