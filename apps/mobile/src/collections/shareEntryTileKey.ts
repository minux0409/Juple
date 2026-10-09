/**
 * The Collection's profile tile (CategoryIconTile) keeps one kept-URI per Collection in an in-memory cache keyed by a number. A link-entry
 * surface (the 컬렉션 추가 / 참가 요청 dialog, 승인 대기 중, the pending placeholder) knows a Collection only by its share link's publicId -
 * never its internal id - so it uses this stable NEGATIVE key derived from the publicId: the same Collection has the same key on every
 * surface (the photo is not reloaded between the dialog and the placeholder) and can never collide with a real Collection id.
 */
export function shareEntryTileKey(publicId: string): number {
  // djb2-style string hash kept in the 32-bit range with plain arithmetic (no bitwise operators).
  let hash = 5381;
  for (let index = 0; index < publicId.length; index += 1) {
    hash = (hash * 33 + publicId.charCodeAt(index)) % 4_294_967_296;
  }
  return -1 - (hash % 1_000_000_000);
}
