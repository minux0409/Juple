import type { PublicCollectionItem } from '../../../lib/publicApi';
import { getDisplayDomain } from '../../../lib/urlDisplay';

export function ItemCard({ item, openLabel }: { item: PublicCollectionItem; openLabel: string }) {
  return (
    <li className="itemCard">
      <p className="itemTitle">{item.title ?? getDisplayDomain(item.url)}</p>
      <p className="itemDomain">{getDisplayDomain(item.url)}</p>
      <a className="itemOpenLink" href={item.url} rel="noopener noreferrer" target="_blank">
        {openLabel}
      </a>
    </li>
  );
}
