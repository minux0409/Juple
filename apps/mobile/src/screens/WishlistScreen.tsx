import { ItemStateListScreen } from './ItemStateListScreen';

export function WishlistScreen() {
  return (
    <ItemStateListScreen
      emptyMessage="아직 위시리스트에 저장한 항목이 없습니다."
      state="wishlist"
      title="Wishlist"
    />
  );
}
