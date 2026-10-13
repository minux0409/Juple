import { notFound } from 'next/navigation';
import { isValidSharePublicId } from '../../../../lib/collectionShareUrl';
import { SharedCollectionEntry } from './SharedCollectionEntry';

/**
 * /shared/{publicId}: a Juple Collection share link opened in the signed-in app (the mobile SharedCollection screen) - from a Home paste,
 * the 새 링크 검토 safety net or typed. Never a saved link. The anonymous share page for everyone else stays /c/{publicId}.
 */
export default async function SharedCollectionPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  if (!isValidSharePublicId(publicId)) {
    notFound();
  }
  return <SharedCollectionEntry key={publicId} publicId={publicId} />;
}
