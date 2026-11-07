import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { ItemHistoryEntry } from './api/itemsApi';

/** What the selection needs of a link card - Home and History pass their ItemHistoryEntry as is. */
export type SavedLinkActionTarget = Pick<ItemHistoryEntry, 'id' | 'url' | 'collectionId'> & {
  /** A link of a locked Collection (redacted by the server): it cannot be selected or acted on. */
  readonly isCollectionLocked?: boolean;
};

interface UseSavedLinkActionsOptions {
  /** Long-press on a card: starts multi-selection with that card chosen (see useSavedLinkSelection). */
  readonly onLongPress: (item: SavedLinkActionTarget) => void;
}

/** A link card can be selected / acted on unless the server redacted it. */
export function hasSavedLinkMenu(item: Pick<SavedLinkActionTarget, 'isCollectionLocked'>): boolean {
  return item.isCollectionLocked !== true;
}

/**
 * The card wiring shared by Home and History (List, Grid and Image): the long-press that starts selection and the 바로가기 button
 * (the saved original page). The per-link actions themselves (컬렉션 변경, 삭제, 링크 열기 ...) live in the selection's bottom bar -
 * there is no longer a centered long-press menu. The card's tap, horizontal swipe and the list's scroll are untouched, and a swipe
 * or scroll cancels a pending long-press the way React Native's Pressable always does.
 */
export function useSavedLinkActions({ onLongPress }: UseSavedLinkActionsOptions) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);

  const openLink = useCallback(async (item: Pick<SavedLinkActionTarget, 'url'>) => {
    // No Linking.canOpenURL pre-check - see ItemDetailsScreen.openOriginalUrl (Android package visibility).
    try {
      await Linking.openURL(item.url);
    } catch {
      setMessage(t('item.urlOpenFailed'));
    }
  }, [t]);

  /** The row/tile props that wire a card to selection: nothing for a redacted (locked) card. */
  const menuProps = (item: SavedLinkActionTarget) => ({ onLongPress: hasSavedLinkMenu(item) ? () => onLongPress(item) : undefined });

  /**
   * The card prop for 바로가기 (the button that opens the saved original page): nothing for a redacted (locked) card, whose URL the
   * server never sent. A failure to open is reported by this hook's own notice.
   */
  const originalLinkProps = (item: SavedLinkActionTarget) => ({ onOpenOriginal: hasSavedLinkMenu(item) ? () => { openLink(item).catch(() => undefined); } : undefined });

  const element = message !== null ? <ConfirmDialog confirmLabel={t('common.confirm')} destructive={false} message={message} onConfirm={() => setMessage(null)} title={t('common.notice')} visible /> : null;

  return { menuProps, originalLinkProps, openLink, element } as const;
}
