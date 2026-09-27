import type { TFunction } from 'i18next';
import { personLabel } from './api/collaborationApi';
import type { Collection } from './api/collectionsApi';

/**
 * "피카츄 · 파이리 외 2명" for a collaborative Collection: the server-chosen preview (other
 * participants only - never the caller - Owner first) by display name, falling back to the Juple
 * ID, plus how many more there are. null when there is no one else to show (a Collection that is
 * not collaborative, or an older response without the summary).
 */
export function formatParticipantSummary(
  collection: Pick<Collection, 'participantPreview' | 'otherParticipantCount'>,
  t: TFunction,
): string | null {
  const preview = collection.participantPreview ?? [];
  if (preview.length === 0) {
    return null;
  }

  const names = preview.map(personLabel).join(' · ');
  const remaining = Math.max(0, (collection.otherParticipantCount ?? preview.length) - preview.length);
  return remaining > 0 ? t('collections.participantsMore', { names, count: remaining }) : names;
}
