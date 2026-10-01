import {
  emojiOfReaction,
  isKnownReaction,
  MAX_RECENT_REACTIONS,
  QUICK_REACTION_KEYS,
  REACTION_CATALOG,
  sortReactions,
  summarizeForCard,
  toItemReactions,
  withMyReaction,
  type ItemReactions,
} from '../reactionCatalog';
import { pushRecentReaction } from '../recentReactions';

describe('the reaction catalog', () => {
  it('has unique stable keys and one emoji each - 24 to 40 of them, so the picker stays balanced', () => {
    const keys = REACTION_CATALOG.map(reaction => reaction.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(REACTION_CATALOG.map(reaction => reaction.emoji)).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(24);
    expect(keys.length).toBeLessThanOrEqual(40);
    for (const reaction of REACTION_CATALOG) {
      expect(reaction.key).toMatch(/^[a-z][A-Za-z0-9]*$/);
      expect(reaction.key.length).toBeLessThanOrEqual(32);
      expect(reaction.emoji.length).toBeGreaterThan(0);
    }
  });

  it('the quick row is fixed: ❤️ 👍 ✅ 😂 😮 😢 - all in the catalog, in this order', () => {
    expect(QUICK_REACTION_KEYS).toEqual(['heart', 'thumbsUp', 'check', 'laugh', 'wow', 'sad']);
    expect(QUICK_REACTION_KEYS.map(key => emojiOfReaction(key))).toEqual(['❤️', '👍', '✅', '😂', '😮', '😢']);
    expect(REACTION_CATALOG.slice(0, 6).map(reaction => reaction.key)).toEqual([...QUICK_REACTION_KEYS]);
  });

  it('is in step with the server: the same keys in the same order as the backend catalog', () => {
    const fs = require('fs');
    const path = require('path');
    const source: string = fs.readFileSync(
      path.resolve(__dirname, '../../../../../backend/src/Juple.Application/Collections/Reactions/CollectionReactions.cs'),
      'utf8',
    );
    const block = source.slice(source.indexOf('Keys ='), source.indexOf('];', source.indexOf('Keys =')));
    const serverKeys = [...block.matchAll(/"([A-Za-z0-9]+)"/g)].map(match => match[1]);
    expect(REACTION_CATALOG.map(reaction => reaction.key)).toEqual(serverKeys);
  });

  it('draws only keys it knows', () => {
    expect(isKnownReaction('heart')).toBe(true);
    expect(isKnownReaction('☺')).toBe(false);
    expect(emojiOfReaction('someFutureKey')).toBeNull();
  });
});

describe('sorting and the card summary', () => {
  it('most used first, equal counts in catalog order, empty and unknown reactions dropped', () => {
    const sorted = sortReactions([
      { key: 'fire', count: 2 },
      { key: 'heart', count: 2 },
      { key: 'laugh', count: 5 },
      { key: 'thumbsUp', count: 0 },
      { key: 'futureKey', count: 9 },
    ]);

    expect(sorted.map(reaction => reaction.key)).toEqual(['laugh', 'heart', 'fire']);
  });

  it('shows at most three kinds and counts the rest as +N; nothing when nobody reacted', () => {
    const many = ['heart', 'thumbsUp', 'check', 'laugh', 'wow'].map((key, index) => ({ key, count: 10 - index }));

    expect(summarizeForCard(many)).toEqual({ visible: many.slice(0, 3), hiddenKinds: 2 });
    expect(summarizeForCard(many.slice(0, 3))).toEqual({ visible: many.slice(0, 3), hiddenKinds: 0 });
    expect(summarizeForCard([])).toEqual({ visible: [], hiddenKinds: 0 });
  });

  it('reads a wire value: missing means none', () => {
    expect(toItemReactions(undefined, undefined)).toEqual({ reactions: [], myReaction: null });
    expect(toItemReactions([{ key: 'heart', count: 1 }], 'heart')).toEqual({ reactions: [{ key: 'heart', count: 1 }], myReaction: 'heart' });
  });
});

describe('withMyReaction - the optimistic move of the counts', () => {
  const base: ItemReactions = { reactions: [{ key: 'heart', count: 3 }, { key: 'thumbsUp', count: 1 }], myReaction: null };

  it('adding one: that reaction gains one', () => {
    const next = withMyReaction(base, 'heart');

    expect(next.myReaction).toBe('heart');
    expect(next.reactions).toEqual([{ key: 'heart', count: 4 }, { key: 'thumbsUp', count: 1 }]);
  });

  it('a new reaction: it appears with 1', () => {
    expect(withMyReaction(base, 'laugh').reactions).toEqual([{ key: 'heart', count: 3 }, { key: 'thumbsUp', count: 1 }, { key: 'laugh', count: 1 }]);
  });

  it('taking it back: it loses one, and a reaction nobody has left disappears', () => {
    const mine: ItemReactions = { reactions: [{ key: 'heart', count: 3 }, { key: 'thumbsUp', count: 1 }], myReaction: 'thumbsUp' };

    const next = withMyReaction(mine, null);

    expect(next.myReaction).toBeNull();
    expect(next.reactions).toEqual([{ key: 'heart', count: 3 }]);
  });

  it('changing it: the old one loses one and the new one gains one - never both at once', () => {
    const mine: ItemReactions = { reactions: [{ key: 'heart', count: 3 }, { key: 'thumbsUp', count: 1 }], myReaction: 'thumbsUp' };

    const next = withMyReaction(mine, 'heart');

    expect(next.myReaction).toBe('heart');
    expect(next.reactions).toEqual([{ key: 'heart', count: 4 }]);
    expect(next.reactions.reduce((sum, reaction) => sum + reaction.count, 0)).toBe(4);
  });

  it('the same reaction is no change', () => {
    const mine: ItemReactions = { reactions: [{ key: 'heart', count: 3 }], myReaction: 'heart' };

    expect(withMyReaction(mine, 'heart')).toBe(mine);
  });
});

describe('recent reactions', () => {
  it('newest first, no duplicates, at most six', () => {
    let recent: readonly string[] = [];
    for (const key of ['heart', 'fire', 'laugh', 'heart', 'eyes', 'pray', 'party', 'cool']) {
      recent = pushRecentReaction(recent, key);
    }

    expect(recent).toEqual(['cool', 'party', 'pray', 'eyes', 'heart', 'laugh']);
    expect(recent).toHaveLength(MAX_RECENT_REACTIONS);
  });
});
