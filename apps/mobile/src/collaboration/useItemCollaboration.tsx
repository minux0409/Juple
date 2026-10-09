import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getCollectionUnlockToken } from '../collections/collectionUnlockGrants';
import { CommentComposer } from '../comments/CommentComposer';
import { CommentList } from '../comments/CommentList';
import { usePersonProfile } from '../friends/PersonProfileModal';
import { useItemComments } from '../comments/useItemComments';
import { useAppToast } from '../components/AppToast';
import { useMessageDialog } from '../components/useMessageDialog';
import { ReactionChips } from '../reactions/ReactionChips';
import { ReactionPickerDialog } from '../reactions/ReactionPickerDialog';
import { useRecentReactions } from '../reactions/recentReactions';
import type { ReactionCount } from '../reactions/reactionCatalog';
import { useItemReactions } from '../reactions/useItemReactions';

/** What the server sent with a link of a Collection: the counts and the caller's own reaction. */
export interface CollaborationRow {
  readonly reactions?: readonly ReactionCount[] | null;
  readonly myReaction?: string | null;
}

interface UseItemCollaborationOptions {
  /** The Collection the link is being looked at IN - reactions and comments belong to (Collection, link), never to the link alone. */
  readonly collectionId: number;
  readonly itemId: number;
  /** The caller owns the Collection: every comment may be deleted (the server decides the same). */
  readonly isCollectionOwner: boolean;
  /**
   * The link's reactions as the server sent them for THIS Collection (a stable object - a new one
   * means a fresh server state), or null while they are not known yet.
   */
  readonly row: CollaborationRow | null;
  /** Off outside a collaborative Collection: nothing is requested and nothing is drawn. */
  readonly enabled: boolean;
  /** A reply / heart notification: the top-level comment whose thread opens once the comments are loaded. */
  readonly focusThreadRootId?: number | null;
}

/**
 * The collaboration of one link of a shared Collection - its emoji reactions (chips and the full
 * picker) and its comments (the list and the composer) - the same wherever the link is opened: the
 * read-only view of someone else's link, and the owner's ItemDetails for the caller's own link. Both
 * screens use this one hook, so reacting, commenting, deleting, paging and the lock gate behave
 * identically.
 *
 * It returns two pieces to place: \`content\` (reaction chips, comments) and \`composer\` (the comment
 * field - the shared view pins it to the bottom, ItemDetails puts it at the end of its form). All are
 * null while \`enabled\` is false or \`row\` is unknown. Everything here is its own state: reacting or
 * commenting never reloads the link or touches the screen's drafts.
 */
export function useItemCollaboration({ collectionId, itemId, isCollectionOwner, row, enabled, focusThreadRootId = null }: UseItemCollaborationOptions): {
  readonly reactions: ReactNode;
  readonly comments: ReactNode;
  readonly composer: ReactNode;
} {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const { showNotificationToast } = useAppToast();
  // A failed EDIT is the result of something the person just did with text they typed: a centered message, not a toast.
  const { showMessage, messageDialog } = useMessageDialog();
  const unlockToken = () => getCollectionUnlockToken(collectionId);
  const reactions = useItemReactions(authenticatedRequest, collectionId, unlockToken, () => showNotificationToast(t('reactions.error')));
  const { recent: recentReactions, recordRecent: recordRecentReaction } = useRecentReactions();
  const comments = useItemComments(
    authenticatedRequest,
    collectionId,
    itemId,
    unlockToken,
    kind => {
      if (kind === 'edit') {
        showMessage(t('comments.editError'));
        return;
      }
      showNotificationToast(
        t(kind === 'send' ? 'comments.sendError' : kind === 'delete' ? 'comments.deleteError' : kind === 'like' ? 'comments.likeError' : 'comments.loadError'),
      );
    },
    enabled,
    focusThreadRootId,
  );
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  // An author's profile on tap: ONE rule for every avatar in the app (me / friend / not yet a friend, resolved on demand - never per comment).
  const { openProfile, profileModal } = usePersonProfile();
  const rowRef = useRef<CollaborationRow | null>(null);
  rowRef.current = row;

  if (!enabled || row === null) {
    return { reactions: null, comments: null, composer: null };
  }

  const react = (key: string) => {
    const current = rowRef.current;
    if (current) {
      recordRecentReaction(key);
      reactions.react(itemId, current, key).catch(() => undefined);
    }
  };
  const reactionState = reactions.reactionsOf(itemId, row);

  return {
    reactions: (
      <>
        {/* The add affordance is always here (a card stays clean, this screen invites). */}
        <ReactionChips alwaysShowAdd onAdd={() => setIsPickerVisible(true)} onToggle={react} reactions={reactionState} testID="shared-item-reactions" />
        <ReactionPickerDialog
          myReaction={reactionState.myReaction}
          onClose={() => setIsPickerVisible(false)}
          onSelect={key => {
            setIsPickerVisible(false);
            react(key);
          }}
          recent={recentReactions}
          visible={isPickerVisible}
        />
      </>
    ),
    comments: (
      <>
        <CommentList
          canDeleteAny={isCollectionOwner}
          comments={comments.comments}
          hasPrevious={comments.hasPrevious}
          isLoadingPrevious={comments.isLoadingPrevious}
          onDelete={commentId => {
            comments.remove(commentId).catch(() => undefined);
          }}
          onEdit={comments.startEdit}
          onOpenProfile={comment => openProfile({
            jupleId: comment.author.jupleId,
            displayName: comment.author.displayName,
            profileImageUrl: comment.author.profileImageUrl,
            profileImageVersion: comment.author.profileImageVersion,
            isSelf: comment.author.isMe,
          })}
          onLoadMoreReplies={rootId => {
            comments.loadMoreReplies(rootId).catch(() => undefined);
          }}
          onLoadPrevious={() => {
            comments.loadPrevious().catch(() => undefined);
          }}
          onReply={comments.startReply}
          onRetry={() => {
            comments.load().catch(() => undefined);
          }}
          onRetryReplies={comments.retryReplies}
          onToggleLike={target => {
            comments.toggleLike(target).catch(() => undefined);
          }}
          onToggleReplies={comments.toggleReplies}
          status={comments.status}
          threads={comments.threads}
          totalCount={comments.totalCount}
        />
        {profileModal}
        {messageDialog}
      </>
    ),
    composer: (
      <CommentComposer
        editTarget={comments.editTarget}
        isSending={comments.isSending}
        onCancelEdit={comments.cancelEdit}
        onCancelReply={comments.cancelReply}
        onSubmit={comments.editTarget ? comments.saveEdit : comments.send}
        replyTarget={comments.replyTarget}
      />
    ),
  };
}
