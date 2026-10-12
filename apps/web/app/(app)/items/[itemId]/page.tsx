import { ItemDetailsView } from './ItemDetailsView';

export default async function ItemDetailsPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return <ItemDetailsView itemIdParam={itemId} key={itemId} />;
}
