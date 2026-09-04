import { useTranslation } from 'react-i18next';
import { ItemStateListScreen } from './ItemStateListScreen';

export function WishlistScreen() {
  const { t } = useTranslation();

  return (
    <ItemStateListScreen
      emptyMessage={t('itemList.wishlistEmpty')}
      state="wishlist"
      title={t('itemList.wishlistTitle')}
    />
  );
}
