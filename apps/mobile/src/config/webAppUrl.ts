import { publicWebConfig } from './publicWebConfig';

/** The Juple Web app used when no public web host is configured for the build (the production site). */
export const DEFAULT_WEB_HOST = 'juple.co.kr';

// A bare host (optionally with a port) - anything with a scheme, path or whitespace is refused rather than guessed at.
const BARE_HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

/**
 * Where "Juple 웹 열기" goes: the Web app on the build's own public web host (Dev builds open the Dev site), else the production
 * site. Always a plain HTTPS origin - never a path, a query, a session or a token.
 */
export function buildWebAppUrl(host: string | undefined): string {
  const trimmed = host?.trim();
  return `https://${trimmed && BARE_HOST.test(trimmed) ? trimmed : DEFAULT_WEB_HOST}`;
}

export const webAppUrl: string = buildWebAppUrl(publicWebConfig.host);
