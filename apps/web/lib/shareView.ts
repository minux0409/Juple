import {
  getPublicCollection,
  getPublicCollectionItems,
  LOCKED,
  type PublicCollectionItem,
} from './publicApi.ts';

export const ITEMS_PAGE_LIMIT = 50;

export type ShareView =
  /** Unknown, revoked or deleted - never distinguished. */
  | { readonly kind: 'notFound' }
  /** The backend could not be reached or answered with an error: temporary, nothing is said about the share. */
  | { readonly kind: 'unavailable' }
  /** Password required (or the grant expired): nothing about the content was fetched. */
  | { readonly kind: 'locked' }
  /** The link exists but the Collection is not public: only its name is known. Joining is requested in the app - no content is fetched here. */
  | { readonly kind: 'private'; readonly name: string }
  | {
      readonly kind: 'ready';
      readonly name: string;
      readonly isLocked: boolean;
      readonly items: readonly PublicCollectionItem[];
      readonly nextCursor: string | null;
    };

export interface ShareApi {
  readonly getCollection: typeof getPublicCollection;
  readonly getItems: typeof getPublicCollectionItems;
}

const defaultApi: ShareApi = { getCollection: getPublicCollection, getItems: getPublicCollectionItems };

/**
 * Everything the share page shows, in one place: the state (ready / locked / not found / temporarily unavailable) and - for a
 * ready share - ONLY the three public fields of each link. The mapping is explicit so a field the API might one day add (a memo,
 * a photo, who added it) can never reach the HTML, the metadata or the client props through this page.
 */
export async function loadShareView(
  apiBaseUrl: string,
  publicId: string,
  unlockToken: string | undefined,
  api: ShareApi = defaultApi,
): Promise<ShareView> {
  try {
    const collection = await api.getCollection(apiBaseUrl, publicId, unlockToken);
    if (collection === null) {
      return { kind: 'notFound' };
    }
    if (collection.name === null) {
      return { kind: 'locked' };
    }

    // 공용 컬렉션 OFF: nothing of the content is requested, let alone shown.
    if (collection.isPublic === false) {
      return { kind: 'private', name: collection.name };
    }

    const firstPage = await api.getItems(apiBaseUrl, publicId, { limit: ITEMS_PAGE_LIMIT, unlockToken });
    // Revoked between the two requests: exactly like the first 404. A grant that expired in that instant: the password form.
    if (firstPage === null) {
      return { kind: 'notFound' };
    }
    if (firstPage === LOCKED) {
      return { kind: 'locked' };
    }

    return {
      kind: 'ready',
      name: collection.name,
      isLocked: collection.isLocked,
      items: firstPage.items.map(item => ({ title: item.title, url: item.url, previewImageUrl: item.previewImageUrl })),
      nextCursor: firstPage.nextCursor,
    };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * Link-preview metadata. The Collection's name appears only for a share that is actually readable (ready); every other state is
 * the plain "Juple" - a locked, revoked or failing share reveals nothing, not even that it exists. Never an image, never a memo.
 */
export function buildShareMetadata(view: ShareView, canonicalUrl: string | null, description: string) {
  const title = view.kind === 'ready' ? `${view.name} - Juple` : 'Juple';
  return {
    title,
    description,
    robots: { index: false, follow: false },
    ...(canonicalUrl && view.kind === 'ready' ? { alternates: { canonical: canonicalUrl } } : {}),
    openGraph: {
      title,
      description,
      siteName: 'Juple',
      type: 'website' as const,
      ...(canonicalUrl && view.kind === 'ready' ? { url: canonicalUrl } : {}),
    },
    twitter: { card: 'summary' as const, title, description },
  };
}
