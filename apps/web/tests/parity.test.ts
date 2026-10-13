import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError, type AppApi, type AppApiRequest } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES, formatMessage, parseLanguagePreference, resolveAppLanguage, resolveSystemLanguage } from '../lib/appI18n.ts';
import { MOBILE_STRINGS } from '../lib/appI18nMobile.generated.ts';
import { MOBILE_STRING_KEYS } from '../lib/appI18nMobileKeys.ts';
import { appendPage, canLoadMore, failLoadingMore, firstPage, pageLoadStep, startLoadingMore } from '../lib/paging.ts';

const ko = getAppDictionary('ko');

/** A recording stand-in for the authenticated API helper: answers each request from a script, never the network. */
function recordingApi(answer: (request: AppApiRequest) => unknown): { readonly api: AppApi; readonly calls: AppApiRequest[] } {
  const calls: AppApiRequest[] = [];
  const api = (async (request: AppApiRequest) => {
    calls.push(request);
    const result = answer(request);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }) as AppApi;
  return { api, calls };
}

describe('infinite scroll paging', () => {
  it('one page at a time, never a duplicate, nothing lost on failure, nothing after the last page', () => {
    let state = firstPage([{ id: 1 }, { id: 2 }], 'c1');
    assert.equal(pageLoadStep(state), 'idle');
    assert.equal(canLoadMore(state), true);
    state = startLoadingMore(state);
    assert.equal(pageLoadStep(state), 'loading');
    assert.equal(canLoadMore(state), false, 'a second request never starts while one is on its way');
    state = appendPage(state, { items: [{ id: 2 }, { id: 3 }], nextCursor: 'c2' }, item => item.id);
    assert.deepEqual(state.items.map(item => item.id), [1, 2, 3]);
    state = failLoadingMore(startLoadingMore(state));
    assert.equal(pageLoadStep(state), 'failed');
    assert.deepEqual(state.items.map(item => item.id), [1, 2, 3], 'what was loaded stays');
    state = appendPage(startLoadingMore(state), { items: [{ id: 4 }], nextCursor: null }, item => item.id);
    assert.equal(pageLoadStep(state), 'end');
    assert.equal(canLoadMore(state), false);
  });

  it('the list end shows skeletons while loading, a retry after a failure (no automatic retry), and no "더 보기" anywhere', () => {
    const loadMore = readFileSync(new URL('../app/(app)/InfiniteScroll.tsx', import.meta.url), 'utf8');
    assert.match(loadMore, /IntersectionObserver/);
    assert.match(loadMore, /step === 'loading'[\s\S]*skeleton/);
    assert.match(loadMore, /step === 'failed'[\s\S]*onClick=\{onLoadMore\}/);
    for (const file of readdirSync(new URL('../app/(app)/', import.meta.url), { recursive: true }) as string[]) {
      if (file.endsWith('.tsx')) {
        assert.doesNotMatch(readFileSync(new URL(`../app/(app)/${file.replaceAll('\\', '/')}`, import.meta.url), 'utf8'), /dictionary\.loadMore/, file);
      }
    }
  });
});

describe('Collections: view modes, create, edit, favorite', async () => {
  const views = await import('../lib/collectionsView.ts');
  const editor = await import('../lib/collectionEditor.ts');
  const collection = { id: 7, name: 'Trips', icon: 'Plane', color: 'Mint', itemCount: 2, isFavorite: false, accessRole: 'owner' as const };

  it('List / Grid only (the mobile categoryViewMode), Grid by default; it opens on 즐겨찾기', () => {
    assert.deepEqual([...views.COLLECTION_VIEW_MODES], ['list', 'grid']);
    assert.equal(views.parseCollectionViewMode(null), 'grid');
    assert.equal(views.parseCollectionViewMode('list'), 'list');
    assert.equal(views.parseCollectionViewMode('image'), 'grid');
    assert.equal(views.DEFAULT_COLLECTION_FILTER, 'favorites');
  });

  it('the name rule and the mobile color math (soft custom hues, the id palette a color-less Collection shows)', () => {
    assert.equal(editor.collectionNameError('   ', ko), ko.errorNameRequired);
    assert.equal(editor.collectionNameError('x'.repeat(101), ko), ko.errorNameTooLong);
    assert.equal(editor.collectionNameError(' ok ', ko), null);
    assert.match(editor.customColorFromHue(200), /^#[0-9A-F]{6}$/);
    assert.ok(Math.abs(editor.hueFromCustomColor(editor.customColorFromHue(200)) - 200) < 2);
    assert.equal(editor.effectiveCollectionColor(null, 1), 'Rose');
    assert.equal(editor.effectiveCollectionColor('#aabbcc', 1), '#AABBCC');
    assert.equal(editor.canEditCollection({ accessRole: 'contributor' }), false);
    assert.equal(editor.canAddItemsTo({ accessRole: 'viewer' }), false);
  });

  it('create: one POST with name / icon / color; a photo goes up only after, and its failure keeps the Collection', async () => {
    const file = new File(['x'], 'icon.png', { type: 'image/png' });
    const { api, calls } = recordingApi(request => (request.method === 'PUT' ? new ApiHttpError(400, null) : { ...collection, id: 9 }));
    const outcome = await editor.createCollection(api, { name: ' Trips ', icon: 'Plane', color: 'Mint', image: { kind: 'set', file } }, ko);
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), ['POST /api/v1/collections', 'PUT /api/v1/collections/9/icon-image']);
    assert.deepEqual(calls[0].body, { name: 'Trips', icon: 'Plane', color: 'Mint' });
    assert.ok(calls[1].body instanceof FormData);
    assert.deepEqual(outcome, { ok: true, collection: { ...collection, id: 9 }, warning: ko.iconPhotoInvalid });
  });

  it('create: a taken name is the mobile 409 message', async () => {
    const { api } = recordingApi(() => new ApiHttpError(409, null));
    const outcome = await editor.createCollection(api, { name: 'Trips', icon: 'Folder', color: 'Blue', image: { kind: 'keep' } }, ko);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.message, ko.errorNameConflict);
  });

  it('edit: only what changed, in the mobile order, stopping at the first failure', async () => {
    const { api, calls } = recordingApi(request => (request.path.endsWith('/color') ? new ApiHttpError(500, null) : { ...collection, icon: 'Heart' }));
    const outcome = await editor.updateCollection(api, collection, { name: 'Travel', icon: 'Heart', color: 'Rose', image: { kind: 'keep' } }, ko);
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), ['PUT /api/v1/collections/7', 'PUT /api/v1/collections/7/icon', 'PUT /api/v1/collections/7/color']);
    assert.equal(!outcome.ok && outcome.message, ko.errorColorUpdate);
    const unchanged = recordingApi(() => collection);
    await editor.updateCollection(unchanged.api, collection, { name: 'Trips', icon: 'Plane', color: 'Mint', image: { kind: 'keep' } }, ko);
    assert.equal(unchanged.calls.length, 0, 'nothing is sent when nothing changed');
  });

  it('the favorite toggle is optimistic and restores the previous state when the server refuses', () => {
    const view = readFileSync(new URL('../app/(app)/collections/[collectionId]/CollectionDetailsView.tsx', import.meta.url), 'utf8');
    assert.match(view, /setHeader\(\{ kind: 'loaded', collection: \{ \.\.\.previous, isFavorite: !previous\.isFavorite \} \}\)/);
    assert.match(view, /error => \{\s*setHeader\(\{ kind: 'loaded', collection: previous \}\)/);
  });
});

describe('Home: adding a link (the mobile Home -> 새 링크 검토 flow)', async () => {
  const link = await import('../lib/newLink.ts');

  it('Home only checks the text and opens the review: a bare URL, else the first URL in pasted text, else the mobile message', () => {
    assert.equal(link.normalizeEnteredUrl(' https://a.test/x '), 'https://a.test/x');
    assert.equal(link.normalizeEnteredUrl('당근에서 이 글을 확인해보세요!\nhttps://b.test/1 '), 'https://b.test/1');
    assert.equal(link.normalizeEnteredUrl('ftp://c.test'), null);
    assert.equal(link.normalizeEnteredUrl('just words'), null);
    assert.equal(link.reviewHref('https://a.test/?q=1&r=2'), '/items/new?url=https%3A%2F%2Fa.test%2F%3Fq%3D1%26r%3D2');
  });

  it('one save request for the link and every chosen Collection, with a retry-safe id and no unlock grant', () => {
    assert.deepEqual(link.saveInboxEntryBody('https://a.test', 'id-1', [3, 4]), { url: 'https://a.test', clientRequestId: 'id-1', collectionIds: [3, 4], unlockTokens: {} });
    assert.deepEqual(link.saveInboxEntryBody('https://a.test', 'id-1', []).collectionIds, [], '선택 안 함 is an explicit empty list');
    const review = readFileSync(new URL('../app/(app)/items/new/NewLinkReviewView.tsx', import.meta.url), 'utf8');
    assert.match(review, /disabled=\{isSaving\} type="submit"/, '선택 안 함 is the starting state, so Save is always available');
  });

  it('the metadata title is never a YouTube placeholder; a share link opens its Collection', async () => {
    assert.equal(link.usableMetadataTitle('https://www.youtube.com/watch?v=1', ' - YouTube'), null);
    assert.equal(link.usableMetadataTitle('https://example.com', 'YouTube'), 'YouTube');
    assert.equal(link.usableMetadataTitle('https://a.test', '  '), null);
    const share = await import('../lib/collectionShareUrl.ts');
    assert.deepEqual(share.refusedShareUrlDestination('https://dev.juple.co.kr/c/AbCdEfGh12345678', 'dev.juple.co.kr'), { kind: 'inApp', href: '/shared/AbCdEfGh12345678' });
    assert.equal(share.refusedShareUrlDestination('https://dev.juple.co.kr/c/x', 'dev.juple.co.kr'), null);
  });

  it('the save outcome says the link was saved and what the chosen Collections did (mobile formatSaveOutcomeMessage)', () => {
    assert.equal(link.saveOutcomeMessage({ addedCount: 2, submittedCount: 0, alreadyPendingCount: 0, alreadyInCollectionCount: 0 }, ko), null);
    assert.equal(link.saveOutcomeMessage({ addedCount: 1, submittedCount: 1, alreadyPendingCount: 0, alreadyInCollectionCount: 1 }, ko), `${formatMessage(ko.saveOutcomeMixed, { added: 1, submitted: 1 })}\n${ko.saveOutcomeAlreadyInCollection}`);
    assert.equal(link.saveErrorMessage(new ApiHttpError(400, null), ko), ko.inboxErrorBadRequest);
    assert.equal(link.saveErrorMessage(new ApiHttpError(503, null), ko), ko.inboxErrorSave);
  });
});

describe('내 페이지 parity', async () => {
  const settings = await import('../lib/settings.ts');
  const subscription = await import('../lib/subscription.ts');

  it('nickname: the server code picks the mobile message; anything else is the save fallback', () => {
    assert.equal(settings.nicknameErrorMessage(new ApiHttpError(400, 'nicknameTooLong'), ko), formatMessage(ko.nicknameTooLong, { max: 30 }));
    assert.equal(settings.nicknameErrorMessage(new ApiHttpError(400, 'nicknameReserved'), ko), ko.nicknameReserved);
    assert.equal(settings.nicknameErrorMessage(new ApiHttpError(400, 'somethingNew'), ko), ko.nicknameInvalid);
    assert.equal(settings.nicknameErrorMessage(new ApiHttpError(500, null), ko), ko.profileSaveFallback);
  });

  it('language: 시스템 설정 uses the mobile rules on the browser languages; a stored choice wins; 17 languages from mobile files', () => {
    assert.equal(resolveSystemLanguage('zh-TW,zh;q=0.9'), 'zh-Hant');
    assert.equal(resolveSystemLanguage('zh-Hans-HK'), 'zh-Hans');
    assert.equal(resolveSystemLanguage('zh'), 'zh-Hans');
    assert.equal(resolveSystemLanguage('pt-PT'), 'pt-BR');
    assert.equal(resolveSystemLanguage('nl;q=1, ja;q=0.8'), 'ja');
    assert.equal(resolveSystemLanguage('nl'), 'en');
    assert.equal(resolveSystemLanguage(null), 'en');
    assert.equal(parseLanguagePreference('fr'), 'fr');
    assert.equal(parseLanguagePreference('xx'), 'system');
    assert.equal(resolveAppLanguage('de', 'ko-KR'), 'de');
    const mobileIndex = readFileSync(new URL('../../mobile/src/i18n/index.ts', import.meta.url), 'utf8');
    const mobileLanguages = [...mobileIndex.match(/SUPPORTED_LANGUAGES = \[([\s\S]*?)\]/)![1].matchAll(/'([\w-]+)'/g)].map(match => match[1]);
    assert.deepEqual([...APP_LANGUAGES], mobileLanguages);
    const keys = Object.keys(MOBILE_STRING_KEYS);
    for (const language of APP_LANGUAGES) {
      assert.deepEqual(Object.keys(MOBILE_STRINGS[language]).sort(), [...keys].sort(), language);
      for (const value of Object.values(MOBILE_STRINGS[language])) {
        assert.doesNotMatch(value, /\{\{/, `${language}: ${value}`);
      }
    }
    assert.equal(getAppDictionary('ja').navMyPage, MOBILE_STRINGS.ja.navMyPage);
    assert.equal(getAppDictionary('ja').back, getAppDictionary('en').back, 'a Web-only string falls back to English, like mobile');
  });

  it('the language table stays on the server (the browser bundle imports only the client-safe module)', () => {
    for (const file of readdirSync(new URL('../app/(app)/', import.meta.url), { recursive: true }) as string[]) {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        const source = readFileSync(new URL(`../app/(app)/${file.replaceAll('\\', '/')}`, import.meta.url), 'utf8');
        if (source.startsWith("'use client'")) {
          assert.doesNotMatch(source, /appI18nMobile\.generated|appDictionary/, file);
        }
      }
    }
  });

  it('collection lock: checked before sending (mobile rules); the server answers map to the mobile messages', () => {
    assert.equal(settings.lockPasswordProblem('change', '', 'abcdef', 'abcdef', ko), ko.lockCurrentPasswordRequired);
    assert.equal(settings.lockPasswordProblem('reset', '', 'abc', 'abc', ko), formatMessage(ko.lockPasswordRule, { min: 6 }));
    assert.equal(settings.lockPasswordProblem('reset', '', 'abcdef', 'abcdeg', ko), ko.lockPasswordMismatch);
    assert.equal(settings.lockPasswordProblem('reset', '', 'abcdef', 'abcdef', ko), null);
    assert.deepEqual(settings.lockSaveFailure(new ApiHttpError(403, 'recentAuthenticationRequired'), ko), { signInExpired: true, message: ko.collectionLockSignInExpired });
    assert.equal(settings.lockSaveFailure(new ApiHttpError(403, 'invalidCollectionPassword'), ko).message, ko.lockWrongCurrentPassword);
    assert.equal(settings.lockSaveFailure(new ApiHttpError(429, null), ko).message, ko.lockTooManyAttempts);
  });

  it('friends: the mobile messages for a refused request', () => {
    assert.equal(settings.friendRequestFailure(new ApiHttpError(409, 'alreadyFriends'), ko), ko.friendsAlreadyFriends);
    assert.equal(settings.friendRequestFailure(new ApiHttpError(409, 'requestPending'), ko), ko.friendsRequestAlreadyPending);
    assert.equal(settings.friendRequestFailure(new ApiHttpError(400, null), ko), ko.friendsCannotAddSelf);
    assert.equal(settings.friendRequestFailure(new ApiHttpError(404, 'requestNoLongerPending'), ko, 'cancel'), ko.friendsRequestNoLongerPending);
    assert.equal(settings.friendRequestFailure(new ApiHttpError(404, 'requestNoLongerPending'), ko, 'answer'), ko.friendsRequestCancelledByRequester);
    assert.equal(settings.friendRequestFailure(new ApiHttpError(404, null), ko), ko.lookupNotFound);
  });

  it('account deletion needs the account\'s own Juple ID typed (spaces, @ and hyphens ignored)', () => {
    assert.equal(settings.isDeletionConfirmed('@abcd-2345', 'ABCD2345'), true);
    assert.equal(settings.isDeletionConfirmed('ABCD2346', 'ABCD2345'), false);
    assert.equal(settings.isDeletionConfirmed('ABCD2345', null), false);
  });

  it('trash: every change is confirmed first, and only what the server confirmed leaves the list', () => {
    const page = readFileSync(new URL('../app/(app)/me/trash/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /\/api\/v1\/items\/\$\{action\.id\}\/restore/);
    assert.match(page, /\/api\/v1\/items\/\$\{action\.id\}\/permanent/);
    assert.match(page, /method: 'DELETE', path: '\/api\/v1\/items\/trash'/);
    assert.match(page, /<ConfirmDialog/);
    assert.match(page, /request\.then\(\s*\(\) => \{\s*\/\/ Only what the server confirmed leaves the list\./);
  });

  it('subscription: the mobile reading of the server facts - never guessed, no date invented', () => {
    const active = subscription.parseStoreSubscription({ state: 'active', platform: 'google', autoRenewing: true, currentPeriodEndsAtUtc: '2026-11-01T00:00:00Z', startedAtUtc: '2026-10-01T00:00:00Z' });
    assert.deepEqual(subscription.describeSubscription(active, null), { kind: 'active', startedAtUtc: '2026-10-01T00:00:00Z', nextPaymentAtUtc: '2026-11-01T00:00:00Z' });
    const canceled = subscription.parseStoreSubscription({ state: 'active', autoRenewing: false, currentPeriodEndsAtUtc: '2026-11-01T00:00:00Z' });
    assert.equal(subscription.describeSubscription(canceled, null).kind, 'canceled');
    assert.equal(subscription.describeSubscription(null, null).kind, 'unknown');
    const programOff = subscription.parseEntitlement({ programEnabled: false, canWrite: true, status: null });
    assert.equal(subscription.describeSubscription(null, programOff).kind, 'none', 'ProgramEnabled=false is never shown as a trial');
    assert.equal(subscription.parseStoreSubscription({ state: 'somethingNew' }), null);
  });
});

describe('UI / parity fix pass', async () => {
  const sharing = await import('../lib/collectionSharing.ts');
  const page = (path: string) => readFileSync(new URL(`../app/(app)/${path}`, import.meta.url), 'utf8');

  it('the review page puts Collections full-width under the link (never in the column beside the preview), 선택 안 함 first', () => {
    const review = page('items/new/NewLinkReviewView.tsx');
    const top = review.indexOf('<ItemFormTop');
    const sourceRow = review.indexOf('<SourceRow url={url} />');
    const sections = review.indexOf('<ItemFormSections>');
    const collections = review.indexOf('<ItemCollectionsSection');
    const memo = review.indexOf('<ItemMemoSection');
    assert.ok(top < sourceRow && sourceRow < sections && sections < collections && collections < memo, 'preview + link, then Collections, then memo');
    const between = review.slice(sourceRow, sections);
    assert.match(between, /<\/ItemFormTop>/, 'the top block is closed before the Collections section starts');
    const picker = page('CollectionPicker.tsx');
    assert.ok(picker.indexOf('{dictionary.collectionNone}') < picker.indexOf('visible.map('), '선택 안 함 comes first');
    const css = page('app.module.css');
    assert.match(css, /\.choiceList \{\s*display: grid;\s*grid-template-columns: repeat\(auto-fill, minmax\(156px, 1fr\)\);/);
  });

  it('every remote picture falls back on error (the broken-image icon is never shown)', () => {
    const image = page('LinkImage.tsx');
    assert.match(image, /onError=\{\(\) => setFailedSrc\(src\)\}/);
    assert.match(image, /if \(!src \|\| src === failedSrc\) \{\s*return <>\{fallback\}<\/>;/);
    for (const file of readdirSync(new URL('../app/(app)/', import.meta.url), { recursive: true }) as string[]) {
      if (file.endsWith('.tsx') && !file.endsWith('LinkImage.tsx') && !file.endsWith('CollectionEditor.tsx')) {
        assert.doesNotMatch(page(file.replaceAll('\\', '/')), /<img\b/, `${file} renders a picture without the fallback`);
      }
    }
  });

  it('the Back button is a real SVG chevron and a word - no character or CSS-drawn glyph that could show on its own', () => {
    const states = page('PageStates.tsx');
    assert.match(states, /<Glyph className=\{styles\.backIcon\} name="Chevron" size=\{18\} \/>/);
    assert.doesNotMatch(states, /backChevron|[‹<]\s*\{dictionary\.back\}/);
    const css = page('app.module.css');
    assert.doesNotMatch(css, /\.backChevron|content:\s*['"]/);
    assert.doesNotMatch(page('items/[itemId]/ItemDetailsView.tsx') + page('collections/[collectionId]/CollectionDetailsView.tsx'), /<Spinner/);
  });

  it('the side bar is navigation only: no account footer and no 로그아웃 (that lives in 내 페이지\'s header)', () => {
    const shell = page('AppShell.tsx');
    assert.doesNotMatch(shell, /signOut|dictionary\.logout|accountLabel|styles\.account/);
    assert.match(page('me/layout.tsx'), /dictionary\.logout/);
  });

  it('share: the Owner always, a member only with a live public link; participants only for a collaborative Collection', () => {
    assert.equal(sharing.canShareCollection({ accessRole: 'owner' }, null), true);
    assert.equal(sharing.canShareCollection({ accessRole: undefined }, null), true);
    assert.equal(sharing.canShareCollection({ accessRole: 'viewer' }, null), false);
    assert.equal(sharing.canShareCollection({ accessRole: 'contributor' }, 'https://dev.juple.co.kr/c/AbCdEfGh12345678'), true);
    assert.equal(sharing.isCollaborative({ accessRole: 'owner', hasCollaborators: false, isPublicShareActive: false }), false);
    assert.equal(sharing.isCollaborative({ accessRole: 'owner', hasCollaborators: true }), true);
    assert.equal(sharing.isCollaborative({ accessRole: 'submitter' }), true);
    const details = page('collections/[collectionId]/CollectionDetailsView.tsx');
    assert.match(details, /canShareCollection\(collection, memberShareUrl\)/);
    assert.match(details, /canEditCollection\(collection\) && \(!isCollectionLocked\(collection\) \|\| unlockTokenFor\(collection\.id\) !== null\)/);
  });

  it('participants: the mobile avatar rules - photo, else the nickname initial, else a person glyph; 4 circles, the last "+N"', () => {
    assert.equal(sharing.avatarInitial('  쥬플'), '쥬');
    assert.equal(sharing.avatarInitial('ana'), 'A');
    assert.equal(sharing.avatarInitial(null), null);
    assert.deepEqual(sharing.avatarStackLayout([1, 2, 3, 4]), { visible: [1, 2, 3, 4], hiddenCount: 0 });
    assert.deepEqual(sharing.avatarStackLayout([1, 2, 3, 4, 5, 6]), { visible: [1, 2, 3], hiddenCount: 3 });
    assert.equal(sharing.participantName({ jupleId: 'ABCD2345', displayName: null, isMe: true }, ko), formatMessage(ko.participantMe, { name: 'ABCD-2345' }));
    assert.equal(sharing.roleLabel('owner', ko), ko.roleOwner);
    assert.equal(sharing.roleLabel('somethingNew', ko), null);
    assert.equal(sharing.shareDescription({ publicId: 'x', shareUrl: 'u', isPublic: false }, ko), ko.sharePrivateDescription);
    assert.equal(sharing.shareDescription({ publicId: 'x', shareUrl: 'u', permission: 'write' }, ko), ko.sharePublicWriteDescription);
    assert.match(page('Avatar.tsx'), /initial \?\? <Glyph name="User"/);
  });
});
