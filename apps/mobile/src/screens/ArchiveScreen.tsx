import { ItemStateListScreen } from './ItemStateListScreen';

export function ArchiveScreen() {
  return (
    <ItemStateListScreen
      emptyMessage="보관한 항목이 없습니다."
      state="archived"
      title="Archive"
    />
  );
}
