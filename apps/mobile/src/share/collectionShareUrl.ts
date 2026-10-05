import { publicWebConfig } from '../config/publicWebConfig';

/** A public link id as the server mints it (base64url) - anything else is not a Collection share link. */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const COLLECTION_PATH_PATTERN = /^\/c\/([^/]+)\/?$/;

/**
 * The public id of a canonical Juple Collection share URL - https://<the configured public web host>/c/{publicId},
 * query string and fragment allowed - or null for anything else. A Collection is never an ordinary link: such a
 * URL must open the Collection flow, never become a saved link (a Collection cannot be nested in another).
 *
 * Decided by parsing the URL against the configured public host - never by display text - so a lookalike host
 * (juple.co.kr.evil.test, dev.juple.co.kr.example), another path on the same host (/about, /c, /c/x/y), a different
 * scheme or a malformed id is NOT a Collection link and saves as the ordinary URL it is. With no host configured
 * (a build without JUPLE_PUBLIC_WEB_HOST) nothing is recognized - there is nothing to guess a host from.
 */
export function parseCollectionShareUrl(value: string | null | undefined, host: string | undefined = publicWebConfig.host): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !host || /\s/.test(trimmed)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return null;
  }
  if (url.hostname.toLowerCase() !== host.trim().toLowerCase() || (url.port !== '' && url.port !== '443')) {
    return null;
  }
  const match = COLLECTION_PATH_PATTERN.exec(url.pathname);
  if (!match) {
    return null;
  }
  let publicId: string;
  try {
    publicId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return PUBLIC_ID_PATTERN.test(publicId) ? publicId : null;
}

/** The server's stable 400 code when a normal save is refused because the URL is a Juple Collection share link. */
export const COLLECTION_SHARE_URL_NOT_SAVABLE_CODE = 'collectionShareUrlNotSavableAsLink';

/**
 * The public id inside a URL the SERVER already judged to be a Collection share link (so no host is checked again -
 * this build may not know the public host). Null when the path does not hold one.
 */
export function publicIdFromServerVerifiedShareUrl(value: string | null | undefined): string | null {
  try {
    const match = COLLECTION_PATH_PATTERN.exec(new URL(value?.trim() ?? '').pathname);
    const publicId = match ? decodeURIComponent(match[1]) : null;
    return publicId !== null && PUBLIC_ID_PATTERN.test(publicId) ? publicId : null;
  } catch {
    return null;
  }
}

export function isCollectionShareUrl(value: string | null | undefined, host?: string): boolean {
  return parseCollectionShareUrl(value, host) !== null;
}
