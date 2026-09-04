import { useTranslation } from 'react-i18next';
import { ItemStateListScreen } from './ItemStateListScreen';

export function ArchiveScreen() {
  const { t } = useTranslation();

  return (
    <ItemStateListScreen
      emptyMessage={t('itemList.archiveEmpty')}
      state="archived"
      title={t('itemList.archiveTitle')}
    />
  );
}
