import { publicWebConfig } from './publicWebConfig';

/**
 * Where 이용약관 and 개인정보처리방침 open (the person's browser): the public legal pages served by apps/web
 * (`/terms`, `/privacy`) on the same public web host the app already uses for Collection share links
 * (JUPLE_PUBLIC_WEB_HOST, see publicWebConfig). No host is configured -> no URL, and the Customer Center shows
 * each row only once its URL exists; nothing is invented. The pages must be deployed on that host for the links to resolve.
 */
export interface LegalLinks {
  readonly termsUrl: string | null;
  readonly privacyUrl: string | null;
}

// A bare host (optionally with a port) - anything with a scheme, path or whitespace is refused rather than guessed at.
const BARE_HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

export function buildLegalLinks(host: string | undefined): LegalLinks {
  const trimmed = host?.trim();
  if (!trimmed || !BARE_HOST.test(trimmed)) {
    return { termsUrl: null, privacyUrl: null };
  }
  return { termsUrl: `https://${trimmed}/terms`, privacyUrl: `https://${trimmed}/privacy` };
}

export const legalLinks: LegalLinks = buildLegalLinks(publicWebConfig.host);
