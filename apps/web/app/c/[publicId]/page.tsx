import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDictionary, resolveLocale } from '../../../lib/i18n';
import { getPublicCollection, getPublicCollectionItems } from '../../../lib/publicApi';
import { ItemList } from './ItemList';

interface PageProps {
  readonly params: Promise<{ publicId: string }>;
}

const ITEMS_PAGE_LIMIT = 50;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { publicId } = await params;
  const collection = await getPublicCollection(publicId);

  return {
    // No fallback to a generic "Juple" title here - an unknown/revoked publicId's metadata must
    // not imply the page exists; the page body itself calls notFound() in that case.
    title: collection ? `${collection.name} - Juple` : 'Juple',
  };
}

export default async function PublicCollectionPage({ params }: PageProps) {
  const { publicId } = await params;

  const requestHeaders = await headers();
  const locale = resolveLocale(requestHeaders.get('accept-language'));
  const dict = getDictionary(locale);

  const collection = await getPublicCollection(publicId);
  if (collection === null) {
    notFound();
  }

  const firstPage = await getPublicCollectionItems(publicId, { limit: ITEMS_PAGE_LIMIT });
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
        emptyLabel={dict.emptyState}
        initialItems={firstPage.items}
        initialNextCursor={firstPage.nextCursor}
        loadingLabel={dict.loading}
        loadMoreLabel={dict.loadMore}
        openLabel={dict.open}
        publicId={publicId}
      />
      <p className="footerNote">{dict.footerNote}</p>
    </main>
  );
}
