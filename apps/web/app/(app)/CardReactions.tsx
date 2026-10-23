'use client';

import { useState } from 'react';
import { ReactionChips, ReactionPicker, useItemReactions, useRecentReactions, type CollaborationRow } from './ItemCollaboration';
import { useSignedInApp } from './AppRoot';
import { useToast } from './Toaster';
import styles from './app.module.css';

/**
 * A shared Collection's link card, line 2 (mobile: the card's ReactionChips under the icon / author line): the reactions with their counts
 * and the add button - the same chips, picker, one-request-at-a-time rule and API as the link's detail, over one shared value
 * (lib/reactionStore.ts), so a tap here shows in an open detail and the other way round. The line exists only while there is at least one
 * reaction (nothing to show = no empty row), and it is a sibling of the card's link, never inside it (a button cannot live in an anchor).
 */
export function CardReactions({ collectionId, itemId, initial }: { readonly collectionId: number; readonly itemId: number; readonly initial: CollaborationRow }) {
  const { dictionary } = useSignedInApp();
  const toast = useToast();
  const reactions = useItemReactions(collectionId, itemId, initial, () => toast.showNotice(dictionary.reactionError, 'error'));
  const { recent, recordRecent } = useRecentReactions();
  const [pickerOpen, setPickerOpen] = useState(false);
  const react = (key: string) => {
    recordRecent(key);
    reactions.react(key);
  };
  if (reactions.state.reactions.length === 0) {
    return null;
  }
  return (
    <div className={styles.cardReactions} data-card-reactions>
      <ReactionChips dictionary={dictionary} onAdd={() => setPickerOpen(true)} onToggle={react} reactions={reactions.state} />
      <ReactionPicker
        dictionary={dictionary}
        myReaction={reactions.state.myReaction}
        onClose={() => setPickerOpen(false)}
        onSelect={key => {
          setPickerOpen(false);
          react(key);
        }}
        open={pickerOpen}
        recent={recent}
      />
    </div>
  );
}
