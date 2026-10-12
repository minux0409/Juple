import { COLLECTION_ICON_MARKUP, STATUS_ICON_MARKUP } from '../../lib/collectionIconMarkup';
import { collectionIconKey } from '../../lib/collectionsView';

/**
 * Draws one of the mobile app's own glyphs (generated into lib/collectionIconMarkup.ts) in currentColor. The markup is a static,
 * trusted constant from this repository - never user data - so it is set as the SVG's inner markup.
 */
export function Glyph({ name, size, className }: { readonly name: keyof typeof STATUS_ICON_MARKUP; readonly size: number; readonly className?: string }) {
  return <svg aria-hidden className={className} dangerouslySetInnerHTML={{ __html: STATUS_ICON_MARKUP[name] }} fill="none" height={size} viewBox="0 0 24 24" width={size} />;
}

export function CollectionGlyph({ icon, size }: { readonly icon: string; readonly size: number }) {
  return <svg aria-hidden dangerouslySetInnerHTML={{ __html: COLLECTION_ICON_MARKUP[collectionIconKey(icon)] }} fill="none" height={size} viewBox="0 0 24 24" width={size} />;
}
