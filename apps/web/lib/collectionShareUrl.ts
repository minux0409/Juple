/**
 * Juple Collection share links. A Collection is never an ordinary link: such a URL opens the Collection flow, never the 새 링크 검토 page
 * or a saved link - in whichever Juple environment it was pasted.
 *
 * Two separate ideas:
 *  - the OFFICIAL share hosts - every Juple environment's links (Production and DEV), recognized everywhere by an exact host match;
 *  - the CURRENT environment's host (JUPLE_PUBLIC_WEB_HOST, see lib/webAppConfig.ts) - which of them this app itself serves.
 * Two routes per environment, never confused:
 *  - /c/{publicId}: the anonymous share landing (outside browsers, search, sharing) - it knows nobody's membership;
 *  - /shared/{publicId}: the signed-in, membership-aware entry (the mobile SharedCollection screen).
 * A link pasted INSIDE Juple always goes to a /shared entry: this environment's own (/shared/{publicId}), or - for another environment's
 * link - that environment's (https://<its host>/shared/{publicId}, a full navigation), which signs the person in there if needed and
 * decides with ITS session, database and membership. This app never asks another environment's API with its own sign-in.
 */

/** Every Juple environment's canonical share host (https://<host>/c/{publicId}). Exact matches only - never a suffix or a substring. */
export const OFFICIAL_SHARE_HOSTS = ['juple.co.kr', 'dev.juple.co.kr'] as const;

/** A public link id as the server mints it (base64url) - anything else is not a Collection share link. */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const COLLECTION_PATH_PATTERN = /^\/c\/([^/]+)\/?$/;

export interface CollectionShareLink {
  readonly publicId: string;
  /** The official host the link belongs to (lower case). */
  readonly host: (typeof OFFICIAL_SHARE_HOSTS)[number];
  /** The link in its canonical form (https://<host>/c/{publicId} - no query, no fragment). */
  readonly canonicalUrl: string;
  /** The link belongs to the environment this app serves (false when this app's host is not configured). */
  readonly sameEnvironment: boolean;
}

function officialHost(hostname: string): (typeof OFFICIAL_SHARE_HOSTS)[number] | null {
  const lower = hostname.toLowerCase();
  return (OFFICIAL_SHARE_HOSTS as readonly string[]).includes(lower) ? (lower as (typeof OFFICIAL_SHARE_HOSTS)[number]) : null;
}

/**
 * A Juple Collection share URL of ANY official environment - https, an official host exactly (juple.co.kr.evil.com, fakejuple.co.kr,
 * dev.juple.co.kr.attacker.com are not), no user info, the default port, the path /c/{publicId} with an optional trailing slash, query
 * string and fragment allowed (the mobile parser's rules) - or null for anything else, which stays the ordinary URL it is.
 */
export function classifyCollectionShareUrl(value: string | null | undefined, currentHost: string | null | undefined): CollectionShareLink | null {
  const trimmed = value?.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || (url.port !== '' && url.port !== '443')) {
    return null;
  }
  const host = officialHost(url.hostname);
  if (host === null) {
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
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    return null;
  }
  return {
    publicId,
    host,
    canonicalUrl: `https://${host}/c/${encodeURIComponent(publicId)}`,
    sameEnvironment: !!currentHost && currentHost.trim().toLowerCase() === host,
  };
}

/** Where a Collection share link goes from this app: this environment's /shared entry, or the other environment's /shared entry. */
export type CollectionShareDestination = { readonly kind: 'inApp'; readonly href: string } | { readonly kind: 'otherEnvironment'; readonly url: string };

export function collectionShareDestination(link: CollectionShareLink): CollectionShareDestination {
  return link.sameEnvironment
    ? { kind: 'inApp', href: sharedCollectionHref(link.publicId) }
    : // Never the other environment's anonymous /c page: it would not know the person (no 추가 / 참가 요청 there).
      { kind: 'otherEnvironment', url: `https://${link.host}${sharedCollectionHref(link.publicId)}` };
}

/** The server's stable 400 code when a normal save is refused because the URL is a Juple Collection share link. */
export const COLLECTION_SHARE_URL_NOT_SAVABLE_CODE = 'collectionShareUrlNotSavableAsLink';

/**
 * The public id inside a URL the SERVER already judged to be a Collection share link of ITS environment (its save answered
 * COLLECTION_SHARE_URL_NOT_SAVABLE_CODE) - the last fallback when the link is not one of the official hosts this app knows. Null when the
 * path does not hold one.
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

/**
 * Where a URL the server refused to save as a link goes: the same rule as everywhere (an official link -> its environment), else - the
 * server recognized it as one of its own - this environment's flow. Never an ordinary saved link.
 */
export function refusedShareUrlDestination(value: string, currentHost: string | null | undefined): CollectionShareDestination | null {
  const link = classifyCollectionShareUrl(value, currentHost);
  if (link) {
    return collectionShareDestination(link);
  }
  const publicId = publicIdFromServerVerifiedShareUrl(value);
  return publicId ? { kind: 'inApp', href: sharedCollectionHref(publicId) } : null;
}

export function isValidSharePublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}

/** This environment's signed-in entry for a Collection share link (the mobile SharedCollection screen). */
export function sharedCollectionHref(publicId: string): string {
  return `/shared/${encodeURIComponent(publicId)}`;
}
