import { redirect } from 'next/navigation';

type Search = { lockedBy?: string | string[]; collectionId?: string | string[] };

/**
 * The details edit themselves now (the title, memo, photo and Collections are changed right on the link's details), so there is no
 * separate editor page any more. An old address of it (a bookmark, a reload) leads to the details with the same context.
 */
export default async function ItemEditPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<Search> }) {
  const { itemId } = await params;
  const search = await searchParams;
  const context = new URLSearchParams();
  if (typeof search.lockedBy === 'string') {
    context.set('lockedBy', search.lockedBy);
  } else if (typeof search.collectionId === 'string') {
    context.set('collectionId', search.collectionId);
  }
  const query = context.toString();
  redirect(`/items/${encodeURIComponent(itemId)}${query ? `?${query}` : ''}`);
}
