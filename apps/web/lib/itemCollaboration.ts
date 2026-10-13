import { formatJupleId } from './accountDisplay.ts';
import type { AppDictionary } from './appI18n.ts';
import { formatMessage } from './appI18n.ts';
import type { CollectionSummary } from './collectionsView.ts';
import { formatLinkTimestamp } from './savedLinks.ts';

/**
 * A link's collaboration IN a Collection for the signed-in Web app - the mobile useItemCollaboration (collaboration/), useItemComments,
 * CommentList / CommentRow / CommentComposer (comments/) and ReactionChips / ReactionPickerDialog / reactionCatalog (reactions/), on
 * the same Backend API. Reactions and comments belong to (Collection, link), never to the link alone:
 *
 *  - Comments: GET /api/v1/collections/{id}/items/{itemId}/comments?limit=30[&before=] (newest page, oldest first; previousCursor for
 *    the page before), POST (body, optional parentCommentId - a reply), PUT .../comments/{commentId} (the author's own words only),
 *    DELETE .../comments/{commentId} (the author, or the Collection's Owner for any).
 *  - Replies: one indent level under their top-level comment, whatever they answer - GET .../comments/{rootId}/replies?limit=20[&after=]
 *    loads a thread only when it is opened. A reply to a reply carries the answered person as metadata (replyTo), never in its text.
 *  - Comment hearts: PUT / DELETE .../comments/{commentId}/like (idempotent; {liked, likeCount}). A heart is not a reaction.
 *  - Reactions: PUT .../reaction {reactionKey} sets or changes the caller's ONE reaction; DELETE takes it back - the server never
 *    toggles, the client decides (the same key again = take back). Only catalog keys are ever sent.
 *  - Who may: the Owner and every accepted member of any role (a Viewer too) - the server answers 404 for anyone else. The Collection's
 *    lock / share password applies exactly as for reading its links (its visit grant in X-Juple-Collection-Unlock).
 *  - Notifications are created by the server alone (a comment, a reply, a heart, a reaction); the Web never calls a notification API.
 */

/** The longest a comment may be (the server's limit too). */
export const MAX_COMMENT_LENGTH = 1000;
/** How many comments one page asks for (mobile COMMENT_PAGE_SIZE). */
export const COMMENT_PAGE_SIZE = 30;
/** How many replies one page of a thread asks for (mobile REPLY_PAGE_SIZE). */
export const REPLY_PAGE_SIZE = 20;

export interface CommentAuthor {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl: string | null;
  readonly profileImageVersion?: string | null;
  readonly isCollectionOwner: boolean;
  readonly isMe: boolean;
}

export interface CommentReplyTarget {
  readonly jupleId: string;
  readonly displayName: string | null;
}

/** Mirrors the Backend CollectionCommentDto (mobile commentsApi ItemComment). The thread fields are additive (absent = plain comment). */
export interface ItemComment {
  readonly id: number;
  /** Plain text - drawn as text only, never as HTML or markdown. Empty on a deleted placeholder. */
  readonly body: string;
  readonly createdAtUtc: string;
  readonly author: CommentAuthor;
  readonly rootCommentId?: number | null;
  readonly parentCommentId?: number | null;
  readonly replyTo?: CommentReplyTarget | null;
  readonly replyCount?: number;
  readonly likeCount?: number;
  readonly viewerLiked?: boolean;
  readonly isDeleted?: boolean;
}

export interface ItemCommentPage {
  readonly items: readonly ItemComment[];
  readonly previousCursor: number | null;
  readonly totalCount: number;
}

export interface CommentReplyPage {
  readonly items: readonly ItemComment[];
  readonly nextCursor: number | null;
  readonly totalCount: number;
}

export interface CommentLikeState {
  readonly liked: boolean;
  readonly likeCount: number;
}

// ---- paths ------------------------------------------------------------------------------------------------------------------

const commentsBase = (collectionId: number, itemId: number) => `/api/v1/collections/${collectionId}/items/${itemId}/comments`;

export function commentsPagePath(collectionId: number, itemId: number, before: number | null = null): string {
  return `${commentsBase(collectionId, itemId)}?limit=${COMMENT_PAGE_SIZE}${before ? `&before=${before}` : ''}`;
}

export function commentsCreatePath(collectionId: number, itemId: number): string {
  return commentsBase(collectionId, itemId);
}

export function commentRepliesPath(collectionId: number, itemId: number, rootCommentId: number, after: number | null = null): string {
  return `${commentsBase(collectionId, itemId)}/${rootCommentId}/replies?limit=${REPLY_PAGE_SIZE}${after ? `&after=${after}` : ''}`;
}

export function commentPath(collectionId: number, itemId: number, commentId: number): string {
  return `${commentsBase(collectionId, itemId)}/${commentId}`;
}

export function commentLikePath(collectionId: number, itemId: number, commentId: number): string {
  return `${commentPath(collectionId, itemId, commentId)}/like`;
}

export function itemReactionPath(collectionId: number, itemId: number): string {
  return `/api/v1/collections/${collectionId}/items/${itemId}/reaction`;
}

/** A top-level comment is exactly the call it always was; only an answer carries the answered comment's id (never a root or a name). */
export function commentCreateBody(body: string, parentCommentId: number | null): { readonly body: string; readonly parentCommentId?: number } {
  return parentCommentId ? { body, parentCommentId } : { body };
}

// ---- where the collaboration is shown ------------------------------------------------------------------------------------------

/**
 * Mobile CollectionDetailsScreen's reactionsEnabled / isCollaborative hand-off to ItemDetails: the Collection is shared with me, or
 * mine with other people in it. An active 모든 사용자 link alone does not make my own link's details collaborative.
 */
export function isCollaborationCollection(collection: Pick<CollectionSummary, 'accessRole' | 'hasCollaborators'>): boolean {
  const sharedWithMe = collection.accessRole === 'contributor' || collection.accessRole === 'viewer' || collection.accessRole === 'submitter';
  return sharedWithMe || collection.hasCollaborators === true;
}

/** The caller owns the Collection (any comment may then be deleted - the server decides the same). An absent role is the Owner's. */
export function ownsCollection(collection: Pick<CollectionSummary, 'accessRole'>): boolean {
  return collection.accessRole === undefined || collection.accessRole === 'owner';
}

// ---- people and words ----------------------------------------------------------------------------------------------------------

/** Mobile personLabel: the nickname, else the public Juple ID. */
export function personLabel(person: { readonly jupleId: string; readonly displayName?: string | null }): string {
  return person.displayName ?? formatJupleId(person.jupleId);
}

/**
 * Mobile stripLegacyReplyMention: older replies stored the answered "@name " inside their body too; that one redundant lead is not shown
 * twice next to the metadata mention. Anything else is kept exactly as written.
 */
export function stripLegacyReplyMention(body: string, targetName: string | null): string {
  if (!targetName) {
    return body;
  }
  const mention = `@${targetName}`;
  if (!body.startsWith(mention)) {
    return body;
  }
  const rest = body.slice(mention.length);
  if (!/^\s/.test(rest)) {
    return body;
  }
  const remainder = rest.replace(/^\s+/, '');
  return remainder.length > 0 ? remainder : body;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Mobile formatCommentTime: 방금 전 / N분 전 / N시간 전 within a day (clock drift reads as 방금 전), then the date and time. */
export function formatCommentTime(createdAtUtc: string, dictionary: AppDictionary, locale: string, now: number = Date.now()): string {
  const age = now - new Date(createdAtUtc).getTime();
  if (Number.isNaN(age) || age < MINUTE_MS) {
    return dictionary.timeJustNow;
  }
  if (age < HOUR_MS) {
    return formatMessage(dictionary.timeMinutesAgo, { count: Math.floor(age / MINUTE_MS) });
  }
  if (age < DAY_MS) {
    return formatMessage(dictionary.timeHoursAgo, { count: Math.floor(age / HOUR_MS) });
  }
  return formatLinkTimestamp(createdAtUtc, locale, true);
}

// ---- what the caller may do (the server decides the same) ----------------------------------------------------------------------

/** Only the author edits their own live comment (not even the Owner someone else's). */
export function canEditComment(comment: ItemComment): boolean {
  return !comment.isDeleted && comment.author.isMe;
}

/** The author deletes their own; the Collection's Owner any. A deleted placeholder has nothing left to delete. */
export function canDeleteComment(comment: ItemComment, isCollectionOwner: boolean): boolean {
  return !comment.isDeleted && (isCollectionOwner || comment.author.isMe);
}

/** 전송 / 수정: off while empty or only whitespace, while a send is on its way, and - editing - until the words really changed. */
export function canSubmitComment(text: string, isSending: boolean, editBody: string | null): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !isSending && (editBody === null || trimmed !== editBody.trim());
}

/**
 * Enter sends, Shift+Enter is a new line - but never while an input method is still composing (Korean / Japanese / Chinese): the Enter
 * that confirms the composed syllable must not send a half-written comment. keyCode 229 is the composing key of browsers that report
 * isComposing late (Safari).
 */
export function isSubmitEnter(event: { readonly key: string; readonly shiftKey: boolean; readonly isComposing?: boolean; readonly keyCode?: number }): boolean {
  return event.key === 'Enter' && !event.shiftKey && event.isComposing !== true && event.keyCode !== 229;
}

// ---- conversation state (mobile useItemComments) -------------------------------------------------------------------------------

/** One thread's replies. Lazy: nothing is fetched until the thread is opened. */
export interface ThreadState {
  readonly expanded: boolean;
  /** idle: never asked; loading / error: the FIRST page; ready: at least the first page is here. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly replies: readonly ItemComment[];
  readonly nextCursor: number | null;
  readonly isLoadingMore: boolean;
  readonly moreFailed: boolean;
}

export type Threads = Readonly<Record<number, ThreadState>>;

export const EMPTY_THREAD: ThreadState = { expanded: false, status: 'idle', replies: [], nextCursor: null, isLoadingMore: false, moreFailed: false };

/** What the caller is answering: the exact comment, its thread root, and the name the composer shows. */
export interface ReplyTarget {
  readonly commentId: number;
  readonly rootCommentId: number;
  readonly name: string;
}

export function replyTargetOf(comment: ItemComment): ReplyTarget | null {
  return comment.isDeleted ? null : { commentId: comment.id, rootCommentId: comment.rootCommentId ?? comment.id, name: personLabel(comment.author) };
}

/** An older page goes in front, never twice the same comment. */
export function prependOlder(current: readonly ItemComment[], older: readonly ItemComment[]): readonly ItemComment[] {
  const known = new Set(current.map(comment => comment.id));
  return [...older.filter(comment => !known.has(comment.id)), ...current];
}

export function appendReplies(current: readonly ItemComment[], page: readonly ItemComment[]): readonly ItemComment[] {
  const known = new Set(current.map(reply => reply.id));
  return [...current, ...page.filter(reply => !known.has(reply.id))];
}

/** One comment changed among the top-level comments (nothing else is touched). */
export function mapTopLevel(comments: readonly ItemComment[], commentId: number, change: (comment: ItemComment) => ItemComment): readonly ItemComment[] {
  return comments.map(entry => (entry.id === commentId ? change(entry) : entry));
}

/** One comment changed inside whichever loaded thread holds it (nothing else is touched). */
export function mapReplies(threads: Threads, commentId: number, change: (comment: ItemComment) => ItemComment): Threads {
  const next: Record<number, ThreadState> = {};
  for (const key of Object.keys(threads).map(Number)) {
    next[key] = { ...threads[key], replies: threads[key].replies.map(entry => (entry.id === commentId ? change(entry) : entry)) };
  }
  return next;
}

/** The heart as asked, applied at once (the server's answer settles it). */
export function withLike(comment: ItemComment, liked: boolean, likeCount: number): ItemComment {
  return { ...comment, viewerLiked: liked, likeCount: Math.max(0, likeCount) };
}

/** A deleted comment keeps its row (its replies hang under it) but nothing of it: no words, no hearts. */
export function toPlaceholder(comment: ItemComment): ItemComment {
  return { ...comment, body: '', isDeleted: true, likeCount: 0, viewerLiked: false };
}

/** A new comment the server stored: a top-level one at the end; a reply raises its thread's count. */
export function withCreatedComment(comments: readonly ItemComment[], created: ItemComment): readonly ItemComment[] {
  const rootId = created.rootCommentId ?? null;
  if (rootId === null) {
    return comments.some(comment => comment.id === created.id) ? comments : [...comments, created];
  }
  return comments.map(comment => (comment.id === rootId ? { ...comment, replyCount: (comment.replyCount ?? 0) + 1 } : comment));
}

/**
 * Removing a comment, as the server cleans up (mobile useItemComments.remove / pruneAfterReplyRemoved): one that others answered stays
 * as a "deleted" placeholder; otherwise it goes - and with a reply, so do the deleted placeholders it was the last answer to, up the
 * chain, and the thread's top-level comment when it is only a placeholder with no replies left. Null when the comment is not shown.
 */
export function withCommentRemoved(
  comments: readonly ItemComment[],
  threads: Threads,
  commentId: number,
): { readonly comments: readonly ItemComment[]; readonly threads: Threads } | null {
  const topLevel = comments.find(comment => comment.id === commentId);
  if (topLevel) {
    return (topLevel.replyCount ?? 0) > 0
      ? { comments: comments.map(comment => (comment.id === commentId ? toPlaceholder(comment) : comment)), threads }
      : { comments: comments.filter(comment => comment.id !== commentId), threads };
  }
  const rootId = Object.keys(threads).map(Number).find(id => threads[id].replies.some(reply => reply.id === commentId));
  if (rootId === undefined) {
    return null;
  }
  const thread = threads[rootId];
  if (thread.replies.some(entry => entry.parentCommentId === commentId)) {
    return { comments, threads: { ...threads, [rootId]: { ...thread, replies: thread.replies.map(entry => (entry.id === commentId ? toPlaceholder(entry) : entry)) } } };
  }
  let replies = thread.replies.filter(entry => entry.id !== commentId);
  let removed = 1;
  let parentId = thread.replies.find(entry => entry.id === commentId)?.parentCommentId ?? rootId;
  while (parentId !== rootId) {
    const parent = replies.find(entry => entry.id === parentId);
    if (!parent || !parent.isDeleted || replies.some(entry => entry.parentCommentId === parent.id)) {
      break;
    }
    replies = replies.filter(entry => entry.id !== parent.id);
    removed += 1;
    parentId = parent.parentCommentId ?? rootId;
  }
  let nextComments = comments.map(comment => (comment.id === rootId ? { ...comment, replyCount: Math.max(0, (comment.replyCount ?? 0) - removed) } : comment));
  const root = nextComments.find(comment => comment.id === rootId);
  if (root?.isDeleted && (root.replyCount ?? 0) === 0) {
    nextComments = nextComments.filter(comment => comment.id !== rootId);
    const rest: Record<number, ThreadState> = { ...threads };
    delete rest[rootId];
    return { comments: nextComments, threads: rest };
  }
  return { comments: nextComments, threads: { ...threads, [rootId]: { ...thread, replies } } };
}

// ---- reactions (mobile reactionCatalog) ----------------------------------------------------------------------------------------

export interface ReactionDefinition {
  readonly key: string;
  readonly emoji: string;
}

/**
 * The server knows only these stable keys (backend CollectionReactionCatalog, same order - it breaks ties between equally used
 * reactions); this is the one place that maps a key to the emoji drawn. A key this build does not know is simply not drawn.
 */
export const REACTION_CATALOG: readonly ReactionDefinition[] = [
  { key: 'heart', emoji: '❤️' },
  { key: 'thumbsUp', emoji: '👍' },
  { key: 'check', emoji: '✅' },
  { key: 'laugh', emoji: '😂' },
  { key: 'wow', emoji: '😮' },
  { key: 'sad', emoji: '😢' },
  { key: 'heartEyes', emoji: '😍' },
  { key: 'lovingFace', emoji: '🥰' },
  { key: 'smile', emoji: '😊' },
  { key: 'kiss', emoji: '😘' },
  { key: 'fire', emoji: '🔥' },
  { key: 'eyes', emoji: '👀' },
  { key: 'pray', emoji: '🙏' },
  { key: 'party', emoji: '🎉' },
  { key: 'cool', emoji: '😎' },
  { key: 'thinking', emoji: '🤔' },
  { key: 'cry', emoji: '😭' },
  { key: 'angry', emoji: '😡' },
  { key: 'thumbsDown', emoji: '👎' },
  { key: 'clap', emoji: '👏' },
  { key: 'ok', emoji: '👌' },
  { key: 'muscle', emoji: '💪' },
  { key: 'hundred', emoji: '💯' },
  { key: 'handshake', emoji: '🤝' },
  { key: 'rofl', emoji: '🤣' },
  { key: 'salute', emoji: '🫡' },
  { key: 'blueHeart', emoji: '💙' },
  { key: 'purpleHeart', emoji: '💜' },
  { key: 'greenHeart', emoji: '💚' },
  { key: 'yellowHeart', emoji: '💛' },
  { key: 'brokenHeart', emoji: '💔' },
  { key: 'star', emoji: '⭐' },
  { key: 'sparkles', emoji: '✨' },
  { key: 'rocket', emoji: '🚀' },
  { key: 'bulb', emoji: '💡' },
  { key: 'pin', emoji: '📌' },
];

/** How many recently used reactions the picker remembers in this browser. */
export const MAX_RECENT_REACTIONS = 6;
/** How many reaction kinds are drawn before the rest collapse into "+N". */
export const MAX_VISIBLE_REACTION_KINDS = 3;
/** This browser's 최근 사용 (a convenience of the picker - never on the server, never part of the account). */
export const RECENT_REACTIONS_STORAGE_KEY = 'juple.web.recentReactions';

const EMOJI_BY_KEY = new Map(REACTION_CATALOG.map(reaction => [reaction.key, reaction.emoji]));
const ORDER_BY_KEY = new Map(REACTION_CATALOG.map((reaction, index) => [reaction.key, index]));

export function emojiOfReaction(key: string): string | null {
  return EMOJI_BY_KEY.get(key) ?? null;
}

export function isKnownReaction(key: string): boolean {
  return EMOJI_BY_KEY.has(key);
}

export interface ReactionCount {
  readonly key: string;
  readonly count: number;
}

/** A link's reactions as the caller sees them: counts per reaction and the caller's own (never who). */
export interface ItemReactions {
  readonly reactions: readonly ReactionCount[];
  readonly myReaction: string | null;
}

/** Most used first; equal counts in catalog order; reactions this build cannot draw are dropped. */
export function sortReactions(reactions: readonly ReactionCount[]): readonly ReactionCount[] {
  return reactions
    .filter(reaction => reaction.count > 0 && isKnownReaction(reaction.key))
    .slice()
    .sort((left, right) => right.count - left.count || (ORDER_BY_KEY.get(left.key) ?? 0) - (ORDER_BY_KEY.get(right.key) ?? 0));
}

export function toItemReactions(reactions: readonly ReactionCount[] | null | undefined, myReaction: string | null | undefined): ItemReactions {
  return { reactions: sortReactions(reactions ?? []), myReaction: myReaction ?? null };
}

/** The same reaction as the caller's own takes it back (null); any other sets or changes it. */
export function nextReaction(current: string | null, chosen: string): string | null {
  return current === chosen ? null : chosen;
}

/** The caller's reaction becoming `next`, applied to the counts (the optimistic update): a person never holds two. */
export function withMyReaction(current: ItemReactions, next: string | null): ItemReactions {
  if (current.myReaction === next) {
    return current;
  }
  const counts = new Map(current.reactions.map(reaction => [reaction.key, reaction.count]));
  if (current.myReaction !== null) {
    counts.set(current.myReaction, (counts.get(current.myReaction) ?? 1) - 1);
  }
  if (next !== null) {
    counts.set(next, (counts.get(next) ?? 0) + 1);
  }
  return { reactions: sortReactions([...counts].map(([key, count]) => ({ key, count }))), myReaction: next };
}

/** The first kinds and how many more kinds there are. */
export function summarizeReactions(
  reactions: readonly ReactionCount[],
  maxKinds: number = MAX_VISIBLE_REACTION_KINDS,
): { readonly visible: readonly ReactionCount[]; readonly hiddenKinds: number } {
  const sorted = sortReactions(reactions);
  return { visible: sorted.slice(0, maxKinds), hiddenKinds: Math.max(0, sorted.length - maxKinds) };
}

/** Newest first, no duplicates, at most MAX_RECENT_REACTIONS. */
export function pushRecentReaction(recent: readonly string[], key: string): readonly string[] {
  return [key, ...recent.filter(existing => existing !== key)].slice(0, MAX_RECENT_REACTIONS);
}

/** What was stored, kept only as far as it is a list of known keys - anything else reads as none. */
export function parseRecentReactions(raw: string | null): readonly string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return [...new Set(parsed.filter((value): value is string => typeof value === 'string' && isKnownReaction(value)))].slice(0, MAX_RECENT_REACTIONS);
  } catch {
    return [];
  }
}
