import { EditCollectionView } from './EditCollectionView';

export default async function EditCollectionPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  return <EditCollectionView collectionIdParam={collectionId} key={collectionId} />;
}
