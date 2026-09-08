import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDictionary, resolveLocale } from '../../../lib/i18n';
import { resolveClientPlatform } from '../../../lib/platform';
import { getPublicCollection, getPublicCollectionItems } from '../../../lib/publicApi';
import { storeConfig } from '../../../lib/storeConfig';
import { InstallCta } from './InstallCta';
import { ItemList } from './ItemList';

interface PageProps {
  readonly params: Promise<{ publicId: string }>;
}

const ITEMS_PAGE_LIMIT = 50;

/**
 * A genuine runtime read, not NEXT_PUBLIC_* - this page is already dynamic (see headers() below),
 * so process.env is safely re-read on every request rather than frozen at `next build` time (see
 * lib/publicApi.ts's own remarks). No real production domain is hardcoded; the local default only
 * applies when the env var is unset (local dev).
 */
function resolveApiBaseUrl(): string {
  return process.env.JUPLE_API_BASE_URL || 'http://localhost:5092';
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { publicId } = await params;
  const collection = await getPublicCollection(resolveApiBaseUrl(), publicId);

  return {
    // No fallback to a generic "Juple" title here - an unknown/revoked publicId's metadata must
    // not imply the page exists; the page body itself calls notFound() in that case.
    title: collection ? `${collection.name} - Juple` : 'Juple',
    // iOS Smart App Banner - only when a real App Store app-id is configured (see
    // lib/storeConfig.ts); no fabricated app-id, and the field is simply absent otherwise.
    ...(storeConfig.appStoreAppId
      ? { other: { 'apple-itunes-app': `app-id=${storeConfig.appStoreAppId}` } }
      : {}),
  };
}

export default async function PublicCollectionPage({ params }: PageProps) {
  const { publicId } = await params;
  const apiBaseUrl = resolveApiBaseUrl();

  const requestHeaders = await headers();
  const locale = resolveLocale(requestHeaders.get('accept-language'));
  const dict = getDictionary(locale);
  const platform = resolveClientPlatform(requestHeaders.get('user-agent'));

  const collection = await getPublicCollection(apiBaseUrl, publicId);
  if (collection === null) {
    notFound();
  }

  const firstPage = await getPublicCollectionItems(apiBaseUrl, publicId, { limit: ITEMS_PAGE_LIMIT });
  // A share revoked in the instant between the two requests above - treat exactly like the
  // collection-level 404, never a partial/broken page.
  if (firstPage === null) {
    notFound();
  }

  return (
    <main>
      <p className="brand">Juple</p>
      <h1 className="collectionName">{collection.name}</h1>
      <ItemList
        apiBaseUrl={apiBaseUrl}
        emptyLabel={dict.emptyState}
        initialItems={firstPage.items}
        initialNextCursor={firstPage.nextCursor}
        loadingLabel={dict.loading}
        loadMoreLabel={dict.loadMore}
        openLabel={dict.open}
        publicId={publicId}
      />
      <InstallCta
        appStoreLabel={dict.appStore}
        googlePlayLabel={dict.googlePlay}
        platform={platform}
        text={dict.installCtaText}
      />
      <p className="footerNote">{dict.footerNote}</p>
    </main>
  );
}
