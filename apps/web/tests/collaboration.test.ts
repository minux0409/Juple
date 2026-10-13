import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { MOBILE_STRING_KEYS } from '../lib/appI18nMobileKeys.ts';
import {
  canDeleteComment,
  canEditComment,
  canSubmitComment,
  commentCreateBody,
  commentLikePath,
  commentPath,
  commentRepliesPath,
  commentsCreatePath,
  commentsPagePath,
  formatCommentTime,
  isCollaborationCollection,
  isSubmitEnter,
  itemReactionPath,
  mapReplies,
  mapTopLevel,
  MAX_COMMENT_LENGTH,
  nextReaction,
  ownsCollection,
  parseRecentReactions,
  personLabel,
  prependOlder,
  appendReplies,
  pushRecentReaction,
  REACTION_CATALOG,
  replyTargetOf,
  sortReactions,
  stripLegacyReplyMention,
  summarizeReactions,
  toItemReactions,
  withCommentRemoved,
  withCreatedComment,
  withLike,
  withMyReaction,
  type ItemComment,
  type Threads,
} from '../lib/itemCollaboration.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = source('app/(app)/app.module.css');
const section = source('app/(app)/ItemCollaboration.tsx');
const hook = source('app/(app)/useItemComments.ts');
const ko = getAppDictionary('ko');
const en = getAppDictionary('en');

const author = (over: Partial<ItemComment['author']> = {}): ItemComment['author'] => ({
  jupleId: 'K7MP4Q8N',
  displayName: '민',
  profileImageUrl: null,
  isCollectionOwner: false,
  isMe: false,
  ...over,
});
const comment = (id: number, over: Partial<ItemComment> = {}): ItemComment => ({ id, body: `c${id}`, createdAtUtc: '2026-10-13T00:00:00Z', author: author(), ...over });
const reply = (id: number, root: number, parent: number, over: Partial<ItemComment> = {}) => comment(id, { rootCommentId: root, parentCommentId: parent, ...over });
const thread = (replies: readonly ItemComment[]): Threads[number] => ({ expanded: true, status: 'ready', replies, nextCursor: null, isLoadingMore: false, moreFailed: false });

describe('collaboration: the same Backend API as mobile (no new endpoint, no notification call)', () => {
  it('comments, replies, hearts, edit, delete and the reaction use the mobile paths and page sizes', () => {
    assert.equal(commentsPagePath(5, 9), '/api/v1/collections/5/items/9/comments?limit=30');
    assert.equal(commentsPagePath(5, 9, 41), '/api/v1/collections/5/items/9/comments?limit=30&before=41');
    assert.equal(commentsCreatePath(5, 9), '/api/v1/collections/5/items/9/comments');
    assert.equal(commentRepliesPath(5, 9, 7), '/api/v1/collections/5/items/9/comments/7/replies?limit=20');
    assert.equal(commentRepliesPath(5, 9, 7, 12), '/api/v1/collections/5/items/9/comments/7/replies?limit=20&after=12');
    assert.equal(commentPath(5, 9, 7), '/api/v1/collections/5/items/9/comments/7');
    assert.equal(commentLikePath(5, 9, 7), '/api/v1/collections/5/items/9/comments/7/like');
    assert.equal(itemReactionPath(5, 9), '/api/v1/collections/5/items/9/reaction');
    const mobile = repo('apps/mobile/src/comments/commentsApi.ts');
    assert.match(mobile, /COMMENT_PAGE_SIZE = 30/);
    assert.match(mobile, /REPLY_PAGE_SIZE = 20/);
    assert.match(mobile, /MAX_COMMENT_LENGTH = 1000/);
    assert.equal(MAX_COMMENT_LENGTH, 1000);
  });

  it('every route the Web calls exists in the Backend controller (verbs included)', () => {
    const controller = repo('backend/src/Juple.Api/Controllers/CollectionsController.cs');
    for (const route of [
      '[HttpGet("{id:long}/items/{itemId:long}/comments")]',
      '[HttpPost("{id:long}/items/{itemId:long}/comments")]',
      '[HttpGet("{id:long}/items/{itemId:long}/comments/{commentId:long}/replies")]',
      '[HttpPut("{id:long}/items/{itemId:long}/comments/{commentId:long}/like")]',
      '[HttpDelete("{id:long}/items/{itemId:long}/comments/{commentId:long}/like")]',
      '[HttpPut("{id:long}/items/{itemId:long}/comments/{commentId:long}")]',
      '[HttpDelete("{id:long}/items/{itemId:long}/comments/{commentId:long}")]',
      '[HttpPut("{id:long}/items/{itemId:long}/reaction")]',
      '[HttpDelete("{id:long}/items/{itemId:long}/reaction")]',
    ]) {
      assert.ok(controller.includes(route), route);
    }
    assert.match(controller, /record PostCommentRequest\(string\? Body, long\? ParentCommentId = null\)/);
    assert.match(controller, /record SetReactionRequest\(string\? ReactionKey\)/);
  });

  it('a reply sends only the answered comment id; a top-level comment sends only its words', () => {
    assert.deepEqual(commentCreateBody('hi', null), { body: 'hi' });
    assert.deepEqual(commentCreateBody('hi', 7), { body: 'hi', parentCommentId: 7 });
  });

  it('the Web never calls a notification API for these actions - the server creates them', () => {
    for (const file of [section, hook, source('lib/itemCollaboration.ts')]) {
      assert.doesNotMatch(file, /\/api\/v1\/notifications|\/push|notifyItemsChanged/);
    }
  });

  it('every request carries the Collection visit grant; a lost session ends the visit', () => {
    const code = section + hook;
    const calls = [...code.matchAll(/api<[^>]+>\(\{/g)].map(match => code.slice(match.index, code.indexOf('})', match.index) + 2));
    assert.ok(calls.length >= 9, String(calls.length));
    for (const call of calls.filter(call => !call.includes('collectionPath('))) {
      assert.match(call, /headers: unlockHeaders\(collectionId\)/, call);
    }
    assert.match(hook, /if \(isSessionLost\(error\)\) \{\s*onSessionLost\(\);/);
  });
});

describe('collaboration: where it is shown (mobile hand-off rules)', () => {
  it('collaborative = shared with me, or mine with members; an active public link alone is not', () => {
    assert.equal(isCollaborationCollection({ accessRole: 'viewer' }), true);
    assert.equal(isCollaborationCollection({ accessRole: 'submitter' }), true);
    assert.equal(isCollaborationCollection({ accessRole: 'contributor' }), true);
    assert.equal(isCollaborationCollection({ accessRole: 'owner', hasCollaborators: true }), true);
    assert.equal(isCollaborationCollection({ accessRole: 'owner', hasCollaborators: false }), false);
    assert.equal(isCollaborationCollection({ accessRole: 'owner' }), false);
    assert.equal(ownsCollection({ accessRole: 'owner' }), true);
    assert.equal(ownsCollection({}), true);
    assert.equal(ownsCollection({ accessRole: 'viewer' }), false);
    const mobile = repo('apps/mobile/src/screens/CollectionDetailsScreen.tsx');
    assert.match(mobile, /reactionsEnabled = !isContentLocked && \(isSharedWithMe\(collection\) \|\| collection\.hasCollaborators === true\)/);
  });

  it('my own link: only when opened IN a Collection (?collectionId=), never from Home / 보관함 (lockedBy) or without context', () => {
    const own = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(own, /\{fromCollectionId !== null \? <ItemCollaboration collectionId=\{fromCollectionId\} itemId=\{itemId\} \/> : null\}/);
    assert.doesNotMatch(own, /<ItemCollaboration[^>]*lockedBy/);
    // The same content serves the Quick Detail sheet and the standalone page.
    assert.match(source('app/(app)/items/[itemId]/QuickDetailSheet.tsx'), /<ItemDetailContent fromCollectionId=\{fromCollectionId\}/);
    assert.match(source('app/(app)/items/[itemId]/ItemDetailsView.tsx'), /<ItemDetailContent fromCollectionId=\{fromCollectionId\}/);
  });

  it("another member's link: always, in both its Quick Detail and its standalone page, from the row already read IN the Collection", () => {
    const quick = source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemContent.tsx');
    const page = source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemView.tsx');
    for (const file of [quick, page]) {
      assert.match(file, /<ItemCollaboration always collectionId=\{collectionId\} itemId=\{item\.itemId\} row=\{item\} \/>/);
    }
    // Read-only = no 수정 / 삭제 of the link itself; reacting and commenting stay.
    assert.doesNotMatch(quick, /dictionary\.edit|dictionary\.delete\b/);
  });

  it('my own link reads its reactions IN that Collection, and only once the Collection is known to be collaborative', () => {
    assert.match(section, /if \(!collaborative \|\| !needsRow\) \{\s*return undefined;/);
    assert.match(section, /path: sharedItemPath\(collectionId, itemId\), headers: unlockHeaders\(collectionId\)/);
    assert.match(section, /if \(!collaborative \|\| context === null \|\| effectiveRow === null\) \{\s*return null;/);
  });

  it("a comment / reply / heart notification about my link opens it IN its Collection, so the conversation is there (mobile collectionContext)", () => {
    assert.match(source('lib/notifications.ts'), /\? `\/items\/\$\{destination\.itemId\}\?collectionId=\$\{destination\.collectionId\}`/);
  });
});

describe('reactions: the mobile catalog, order and rules', () => {
  it('the same 36 keys and emoji in the same order as mobile and the Backend catalog', () => {
    const mobile = repo('apps/mobile/src/reactions/reactionCatalog.ts');
    const mobileEntries = [...mobile.matchAll(/\{ key: '(\w+)', emoji: '([^']+)' \}/g)].map(match => ({ key: match[1], emoji: match[2] }));
    assert.equal(mobileEntries.length, 36);
    assert.deepEqual(REACTION_CATALOG, mobileEntries);
    const backend = repo('backend/src/Juple.Application/Collections/Reactions/CollectionReactions.cs');
    const start = backend.indexOf('class CollectionReactionCatalog');
    const backendKeys = [...backend.slice(start, backend.indexOf('}', backend.indexOf('[', start))).matchAll(/"(\w+)"/g)].map(match => match[1]);
    assert.deepEqual(backendKeys.slice(0, 36), REACTION_CATALOG.map(entry => entry.key));
  });

  it('the same key again takes the reaction back; any other sets or changes it (the server never toggles)', () => {
    assert.equal(nextReaction(null, 'heart'), 'heart');
    assert.equal(nextReaction('heart', 'heart'), null);
    assert.equal(nextReaction('heart', 'fire'), 'fire');
    assert.match(section, /next === null\s*\? api<ItemReactions>\(\{ method: 'DELETE'/);
    assert.match(section, /: api<ItemReactions>\(\{ method: 'PUT', path: itemReactionPath\(collectionId, itemId\), body: \{ reactionKey: next \}/);
  });

  it('optimistic counts: a person holds one reaction; changing moves one count, taking back removes it', () => {
    const start = toItemReactions([{ key: 'heart', count: 2 }, { key: 'fire', count: 1 }], 'heart');
    const changed = withMyReaction(start, 'fire');
    assert.deepEqual(changed, { reactions: [{ key: 'fire', count: 2 }, { key: 'heart', count: 1 }], myReaction: 'fire' });
    assert.deepEqual(withMyReaction(changed, null), { reactions: [{ key: 'heart', count: 1 }, { key: 'fire', count: 1 }], myReaction: null });
    assert.equal(withMyReaction(start, 'heart'), start, 'unchanged');
  });

  it('most used first, ties in catalog order, unknown keys dropped, at most three kinds then +N', () => {
    assert.deepEqual(sortReactions([{ key: 'pin', count: 1 }, { key: 'thumbsUp', count: 1 }, { key: 'nope', count: 9 }, { key: 'fire', count: 3 }, { key: 'sad', count: 0 }]), [
      { key: 'fire', count: 3 },
      { key: 'thumbsUp', count: 1 },
      { key: 'pin', count: 1 },
    ]);
    const summary = summarizeReactions(['heart', 'fire', 'pin', 'star', 'eyes'].map(key => ({ key, count: 1 })));
    assert.deepEqual(summary.visible.map(entry => entry.key), ['heart', 'fire', 'eyes']);
    assert.equal(summary.hiddenKinds, 2);
    assert.deepEqual(toItemReactions(null, undefined), { reactions: [], myReaction: null });
  });

  it('최근 사용: newest first, unique, six at most, only known keys from storage; never sent to the server', () => {
    assert.deepEqual(pushRecentReaction(['a', 'heart', 'b'], 'heart'), ['heart', 'a', 'b']);
    assert.equal(pushRecentReaction(['1', '2', '3', '4', '5', '6'], 'fire').length, 6);
    assert.deepEqual(parseRecentReactions('["fire","x","fire","heart"]'), ['fire', 'heart']);
    assert.deepEqual(parseRecentReactions('{"a":1}'), []);
    assert.deepEqual(parseRecentReactions('not json'), []);
    assert.deepEqual(parseRecentReactions(null), []);
    assert.match(section, /try \{\s*window\.localStorage\.setItem\(RECENT_REACTIONS_STORAGE_KEY/);
  });

  it('one reaction request at a time; a failure restores the previous state', () => {
    assert.match(section, /if \(inFlight\.current\) \{\s*return;/);
    assert.match(section, /error => \{\s*setState\(before\);/);
  });

  it('a heart is not a reaction: comment hearts use their own endpoint and state', () => {
    assert.match(hook, /method: wanted \? 'PUT' : 'DELETE', path: commentLikePath/);
    assert.doesNotMatch(hook, /itemReactionPath/);
  });
});

describe('comments and replies: mobile behaviour', () => {
  it('replies sit at ONE level under their top-level comment, whatever they answer', () => {
    assert.deepEqual(replyTargetOf(comment(1)), { commentId: 1, rootCommentId: 1, name: '민' });
    assert.deepEqual(replyTargetOf(reply(5, 1, 3)), { commentId: 5, rootCommentId: 1, name: '민' });
    assert.equal(replyTargetOf(comment(1, { isDeleted: true })), null, 'a deleted placeholder cannot be answered');
    assert.match(css, /\.commentThreadAction,\s*\.commentReplies \{\s*margin-inline-start: 36px;/);
    assert.match(section, /thread\.replies\.map\(reply => <li key=\{reply\.id\}>\{row\(reply, true\)\}<\/li>\)/);
  });

  it('a new top-level comment goes to the end; a reply raises its thread count; pages never duplicate', () => {
    const list = [comment(1), comment(2)];
    assert.deepEqual(withCreatedComment(list, comment(3)).map(entry => entry.id), [1, 2, 3]);
    assert.deepEqual(withCreatedComment(list, comment(2)).map(entry => entry.id), [1, 2]);
    assert.equal(withCreatedComment(list, reply(4, 1, 1))[0].replyCount, 1);
    assert.deepEqual(prependOlder(list, [comment(0), comment(1)]).map(entry => entry.id), [0, 1, 2]);
    assert.deepEqual(appendReplies([reply(4, 1, 1)], [reply(4, 1, 1), reply(5, 1, 1)]).map(entry => entry.id), [4, 5]);
  });

  it('deleting: answered -> placeholder; unanswered reply -> gone with the placeholders it was the last answer to; empty deleted root goes', () => {
    const top = [comment(1, { replyCount: 2 }), comment(2)];
    assert.deepEqual(withCommentRemoved(top, {}, 2)?.comments.map(entry => entry.id), [1]);
    const placeholder = withCommentRemoved(top, {}, 1);
    assert.equal(placeholder?.comments[0].isDeleted, true);
    assert.equal(placeholder?.comments[0].body, '');

    const threads: Threads = { 1: thread([reply(3, 1, 1, { isDeleted: true }), reply(4, 1, 3)]) };
    const roots = [comment(1, { replyCount: 2, isDeleted: true })];
    const pruned = withCommentRemoved(roots, threads, 4);
    assert.deepEqual(pruned?.comments, [], 'the deleted root with no replies left goes too');
    assert.equal(pruned?.threads[1], undefined);

    const answered: Threads = { 1: thread([reply(3, 1, 1), reply(4, 1, 3)]) };
    const kept = withCommentRemoved([comment(1, { replyCount: 2 })], answered, 3);
    assert.equal(kept?.threads[1].replies[0].isDeleted, true, 'a reply others answered stays as a placeholder');
    assert.equal(withCommentRemoved(top, {}, 99), null);
  });

  it('hearts and edits change one comment wherever it is shown', () => {
    const threads: Threads = { 1: thread([reply(3, 1, 1)]) };
    assert.deepEqual(mapReplies(threads, 3, entry => withLike(entry, true, 2))[1].replies[0].likeCount, 2);
    assert.equal(mapTopLevel([comment(1)], 1, entry => withLike(entry, false, -1))[0].likeCount, 0, 'never below zero');
  });

  it('who may: only the author edits; the author or the Collection Owner deletes; placeholders neither', () => {
    const mine = comment(1, { author: author({ isMe: true }) });
    const theirs = comment(2);
    assert.equal(canEditComment(mine), true);
    assert.equal(canEditComment(theirs), false);
    assert.equal(canDeleteComment(mine, false), true);
    assert.equal(canDeleteComment(theirs, false), false);
    assert.equal(canDeleteComment(theirs, true), true);
    assert.equal(canEditComment(comment(3, { isDeleted: true, author: author({ isMe: true }) })), false);
    assert.equal(canDeleteComment(comment(3, { isDeleted: true }), true), false);
  });

  it('send: not empty / whitespace, not while sending, an edit only once the words changed; the field keeps text on failure', () => {
    assert.equal(canSubmitComment('  ', false, null), false);
    assert.equal(canSubmitComment('hi', true, null), false);
    assert.equal(canSubmitComment('hi', false, null), true);
    assert.equal(canSubmitComment(' same ', false, 'same'), false);
    assert.equal(canSubmitComment('new', false, 'same'), true);
    assert.match(section, /onSubmit\(text\.trim\(\)\)\.then\(sent => \{\s*if \(sent\) \{\s*setText\(''\);/);
    assert.match(section, /maxLength=\{MAX_COMMENT_LENGTH\}/);
  });

  it('IME: Enter sends, Shift+Enter is a new line, and nothing is sent while Korean / Japanese / Chinese input is composing', () => {
    assert.equal(isSubmitEnter({ key: 'Enter', shiftKey: false }), true);
    assert.equal(isSubmitEnter({ key: 'Enter', shiftKey: true }), false);
    assert.equal(isSubmitEnter({ key: 'Enter', shiftKey: false, isComposing: true }), false);
    assert.equal(isSubmitEnter({ key: 'Enter', shiftKey: false, keyCode: 229 }), false);
    assert.equal(isSubmitEnter({ key: 'a', shiftKey: false }), false);
    assert.match(section, /isComposing: event\.nativeEvent\.isComposing, keyCode: event\.keyCode/);
  });

  it('text is text: rendered by React, never as HTML; the legacy "@name " lead is not shown twice', () => {
    assert.doesNotMatch(section, /dangerouslySetInnerHTML/);
    assert.equal(stripLegacyReplyMention('@민 안녕', '민'), '안녕');
    assert.equal(stripLegacyReplyMention('@민수 안녕', '민'), '@민수 안녕');
    assert.equal(stripLegacyReplyMention('@민 ', '민'), '@민 ');
    assert.equal(stripLegacyReplyMention('안녕 @민', '민'), '안녕 @민');
    assert.equal(stripLegacyReplyMention('@민 안녕', null), '@민 안녕');
    assert.equal(personLabel({ jupleId: 'K7MP4Q8N', displayName: null }), 'K7MP-4Q8N');
  });

  it('time: 방금 전 / N분 전 / N시간 전 within a day, then the date (mobile formatCommentTime)', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    assert.equal(formatCommentTime('2026-10-13T11:59:30Z', ko, 'ko', now), ko.timeJustNow);
    assert.equal(formatCommentTime('2026-10-13T12:05:00Z', ko, 'ko', now), ko.timeJustNow, 'clock drift');
    assert.equal(formatCommentTime('2026-10-13T11:55:00Z', ko, 'ko', now), '5분 전');
    assert.equal(formatCommentTime('2026-10-13T09:00:00Z', en, 'en', now), '3h ago');
    assert.match(formatCommentTime('2026-10-10T09:00:00Z', en, 'en', now), /2026/);
  });

  it('paging: 이전 댓글 보기 while older ones exist; a thread loads only when opened, then 답글 더 보기', () => {
    assert.match(section, /\{model\.hasPrevious \? \(/);
    assert.match(hook, /if \(!thread\.expanded && \(thread\.status === 'idle' \|\| thread\.status === 'error'\)\) \{\s*loadFirstReplies\(rootId\);/);
    assert.match(section, /thread\.nextCursor !== null && thread\.status === 'ready'/);
  });

  it('one send at a time; one like / delete per comment at a time; a failed delete puts everything back', () => {
    assert.match(hook, /if \(isSendingRef\.current\) \{\s*return false;/);
    assert.match(hook, /if \(target\.isDeleted \|\| pendingLikesRef\.current\.has\(target\.id\)\) \{/);
    assert.match(hook, /if \(pendingDeletesRef\.current\.has\(commentId\)\) \{/);
    assert.match(hook, /setComments\(snapshot\.comments\);\s*setThreads\(snapshot\.threads\);\s*setTotalCount\(snapshot\.totalCount\);/);
  });

  it('deleting asks first (the mobile confirmation), with its own wording', () => {
    assert.match(section, /<ConfirmDialog[\s\S]*title=\{dictionary\.commentDeleteConfirm\}/);
  });
});

describe('collaboration: words and layout', () => {
  it('every string is the mobile text, in all 17 languages - no new translation', () => {
    const keys = Object.entries(MOBILE_STRING_KEYS).filter(([, mobile]) => mobile.startsWith('comments.') || mobile.startsWith('reactions.'));
    assert.ok(keys.length >= 40, String(keys.length));
    const mobileKo = JSON.parse(repo('apps/mobile/src/i18n/locales/ko.json'));
    for (const [web, mobile] of keys) {
      const [group, name] = mobile.split('.');
      assert.equal(ko[web as keyof typeof ko], String(mobileKo[group][name]).replace(/\{\{(\w+)\}\}/g, '{$1}'), web);
    }
    for (const language of APP_LANGUAGES) {
      const dictionary = getAppDictionary(language);
      for (const [web] of keys) {
        assert.ok(dictionary[web as keyof typeof dictionary], `${language}:${web}`);
      }
    }
    assert.equal(ko.commentsTitle, '댓글 {count}');
    assert.equal(ko.commentReply, '답글 달기');
    assert.equal(ko.reactionPickerTitle, '리액션 추가');
  });

  it('the composer stays in reach at the bottom of the scrolling body; the sheet bar and action column are untouched', () => {
    assert.match(css, /\.commentComposer \{\s*position: sticky;\s*bottom: 0;/);
    assert.match(source('app/(app)/items/[itemId]/QuickDetailSheet.tsx'), /<div className=\{styles\.quickScroll\}>\{children\}<\/div>/);
  });

  it('narrow screens: the picker grid is six per row and the text wraps instead of overflowing', () => {
    assert.match(css, /\.pickerGrid \{\s*display: grid;\s*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
    assert.match(css, /\.commentBody \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);
    assert.match(css, /\.reactionRow \{\s*display: flex;\s*flex-wrap: wrap;/);
    assert.match(css, /\.reactionPicker \{\s*width: min\(420px, calc\(100vw - 32px\)\);/);
  });
});
