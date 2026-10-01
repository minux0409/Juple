/**
 * The emoji reactions a link can get. The server knows only these stable keys (never raw Unicode),
 * so what is stored does not depend on any platform's emoji sequences; this is the one place that
 * maps a key to the emoji drawn for it. The order is the catalog order the server also uses to
 * break ties between equally used reactions - keep the two lists in step (backend
 * CollectionReactionCatalog). A key this build does not know (added by a later server) is simply not
 * drawn.
 */
export interface ReactionDefinition {
  readonly key: string;
  readonly emoji: string;
}

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

/** The fixed quick row at the top of a link's long-press menu (then "+" for the full picker). */
export const QUICK_REACTION_KEYS: readonly string[] = ['heart', 'thumbsUp', 'check', 'laugh', 'wow', 'sad'];

/** How many recently used reactions the picker remembers on this device. */
export const MAX_RECENT_REACTIONS = 6;

/** How many reaction kinds a card draws before the rest collapse into "+N". */
export const MAX_VISIBLE_REACTION_KINDS = 3;

const EMOJI_BY_KEY = new Map(REACTION_CATALOG.map(reaction => [reaction.key, reaction.emoji]));
const ORDER_BY_KEY = new Map(REACTION_CATALOG.map((reaction, index) => [reaction.key, index]));

export function emojiOfReaction(key: string): string | null {
  return EMOJI_BY_KEY.get(key) ?? null;
}

export function isKnownReaction(key: string): boolean {
  return EMOJI_BY_KEY.has(key);
}

/** How many people reacted with this key. */
export interface ReactionCount {
  readonly key: string;
  readonly count: number;
}

/** A link's reactions as the caller sees them: counts per reaction and the caller's own (never who). */
export interface ItemReactions {
  readonly reactions: readonly ReactionCount[];
  readonly myReaction: string | null;
}

export const NO_REACTIONS: ItemReactions = { reactions: [], myReaction: null };

/** Most used first; equal counts in catalog order; reactions this build cannot draw are dropped. */
export function sortReactions(reactions: readonly ReactionCount[]): readonly ReactionCount[] {
  return reactions
    .filter(reaction => reaction.count > 0 && isKnownReaction(reaction.key))
    .slice()
    .sort((left, right) => right.count - left.count || (ORDER_BY_KEY.get(left.key) ?? 0) - (ORDER_BY_KEY.get(right.key) ?? 0));
}

/**
 * The caller's reaction becoming `next` (null = taken back), applied to the counts: the old one
 * loses one, the new one gains one - a person never holds two. Used for the optimistic update; the
 * server's own answer replaces it.
 */
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
  return {
    reactions: sortReactions([...counts].map(([key, count]) => ({ key, count }))),
    myReaction: next,
  };
}

/** What a card draws: the first kinds, how many more kinds there are, and the whole is empty when nobody reacted. */
export function summarizeForCard(
  reactions: readonly ReactionCount[],
  maxKinds: number = MAX_VISIBLE_REACTION_KINDS,
): { readonly visible: readonly ReactionCount[]; readonly hiddenKinds: number } {
  const sorted = sortReactions(reactions);
  return { visible: sorted.slice(0, maxKinds), hiddenKinds: Math.max(0, sorted.length - maxKinds) };
}

/** From a wire value (a missing list is no reactions). */
export function toItemReactions(reactions: readonly ReactionCount[] | null | undefined, myReaction: string | null | undefined): ItemReactions {
  return { reactions: sortReactions(reactions ?? []), myReaction: myReaction ?? null };
}
