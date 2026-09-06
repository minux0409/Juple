/**
 * The Public Web Viewer's origin (see apps/web), used only to recognize an incoming HTTPS
 * Universal/App Link for a Collection Sharing link (see navigation/linking.ts) - a completely
 * separate concern from the Backend API host (see api/apiConfig.ts).
 *
 * Bare host only (no scheme, e.g. "app.juple.com"), inlined at build time the same way
 * JUPLE_API_ENV/JUPLE_API_BASE_URL are (see babel.config.js's `include` allowlist and
 * src/api/apiConfig.ts). No real production domain exists yet (see docs/architecture.md) - this
 * intentionally has no __DEV__ default the way apiConfig.ts's baseUrl does: unlike the Backend,
 * which is always reachable in local dev via `adb reverse`, there is nothing to default a deep
 * link host to locally, so it stays unset in every build until JUPLE_PUBLIC_WEB_HOST is explicitly
 * provided. See linking.ts for the resulting fail-safe (empty prefixes = deep linking is a no-op,
 * never a fabricated host).
 */
declare const process: {
  readonly env: {
    readonly JUPLE_PUBLIC_WEB_HOST?: string;
  };
};

export const publicWebConfig = {
  host: process.env.JUPLE_PUBLIC_WEB_HOST || undefined,
};
