import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  COLLECTION_FILTERS,
  collectionsTabUrl,
  DEFAULT_COLLECTION_FILTER,
  hasGridStatus,
  parseCollectionTab,
  type CollectionSummary,
} from '../lib/collectionsView.ts';
import { isUsableProfilePhoto, PROFILE_IMAGE_PATH, PROFILE_PHOTO_MAX_BYTES, profilePhotoErrorMessage } from '../lib/profilePhoto.ts';
import { nextActiveIndex } from '../lib/listNavigation.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = source('app/(app)/app.module.css');
const dictionary = getAppDictionary('en');

/** The body of the (last) CSS rule for a selector, or null. */
function rule(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))];
  return all.length ? all[all.length - 1][1] : null;
}

const card = (overrides: Partial<CollectionSummary> = {}): CollectionSummary => ({ id: 1, name: 'x', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, ...overrides });

describe('새 링크 검토: 새 컬렉션 (the Collection editor and create request, reused)', () => {
  const picker = source('app/(app)/CollectionPicker.tsx');
  const review = source('app/(app)/items/new/NewLinkReviewView.tsx');

  it('the picker offers "+ 새 컬렉션" only to a caller that handles the result, next to 선택 안 함 (which stays)', () => {
    assert.match(picker, /onCreated\?: \(collection: CollectionSummary\) => void/);
    assert.match(picker, /\{onCreated \? \(\s*<button[^>]*data-collection-create/);
    assert.match(picker, /dictionary\.collectionCreate/);
    assert.match(picker, /dictionary\.collectionNone/);
    assert.ok(picker.indexOf('dictionary.collectionNone') < picker.indexOf('data-collection-create'), '선택 안 함 stays first');
  });

  it('it is the same editor and the same create request as the Collections page - no second form or API', () => {
    assert.match(picker, /import \{ createCollection \} from '..\/..\/lib\/collectionEditor'/);
    assert.match(source('app/(app)/collections/NewCollectionDialog.tsx'), /<CollectionEditor[\s\S]*layout="dialog"[\s\S]*mode="create"/);
    assert.match(picker, /createCollection\(api, draft, dictionary\)/);
  });

  it('its submit never reaches the link form around it (a created Collection must not save the link)', () => {
    assert.match(source('app/(app)/collections/NewCollectionDialog.tsx'), /onSubmit=\{event => event\.stopPropagation\(\)\}>\s*<CollectionEditor/);
    // ... and it is drawn in the page body: a <form> nested in another <form> does not submit on its own (found on DEV)
    assert.match(picker, /closest\('main'\) \?\? document\.body/);
    assert.match(picker, /createPortal\(\s*<NewCollectionDialog[\s\S]*creating\.host/);
  });

  it('a failure stays in the dialog with the name error, a lost session is handled, the draft is kept', () => {
    assert.match(picker, /error: outcome\.message, busy: false/);
    assert.match(picker, /isSessionLost\(outcome\.error\)/);
    assert.match(source('app/(app)/collections/NewCollectionDialog.tsx'), /if \(!busy\) \{\s*onClose\(\);/);
  });

  it('the review adds the new Collection to its list and selects it, keeping what was chosen', () => {
    assert.match(review, /onCreated=\{created => \{[\s\S]*setDestinations\(previous => \[created, \.\.\.\(previous \?\? \[\]\)\.filter\(entry => entry\.id !== created\.id\)\]\);[\s\S]*setSelected\(previous => new Set\(previous\)\.add\(created\.id\)\);/);
    assert.match(review, /onNone=\{\(\) => setSelected\(new Set\(\)\)\}/);
  });

  it('the link editor and the destination dialog do not get the button (only the review was asked for)', () => {
    assert.doesNotMatch(source('app/(app)/DestinationDialog.tsx'), /onCreated/);
  });
});

describe('새 컬렉션 dialog: one shell, normal flow, its own tokens', () => {
  const dialog = source('app/(app)/collections/NewCollectionDialog.tsx');
  const editor = source('app/(app)/collections/CollectionEditor.tsx');

  it('is a single native dialog: head, a scrolling body, a foot with 취소 / 만들기 (the page editor is untouched)', () => {
    assert.match(dialog, /<dialog[\s\S]*styles\.dialogHead[\s\S]*<CollectionEditor/);
    assert.match(editor, /layout === 'dialog'[\s\S]*styles\.dialogBody[\s\S]*styles\.dialogFoot/);
    assert.match(editor, /<form className=\{styles\.editorForm\}[\s\S]*styles\.editorAside/);
    // the fields and the actions are the same pieces for both layouts - one validation, one set of icons / colours
    assert.equal((editor.match(/COLLECTION_ICON_KEYS\.map/g) ?? []).length, 1);
    assert.equal((editor.match(/COLLECTION_COLOR_KEYS\.map/g) ?? []).length, 1);
    assert.match(css, /\.dialog \{[^}]*overflow: hidden/);
    assert.match(rule('.dialogBody') ?? '', /overflow-y: auto/);
    assert.match(rule('.editorDialogForm') ?? '', /flex-direction: column/);
  });

  it('nothing in it is positioned by hand, and it carries the colour tokens itself (light and dark)', () => {
    for (const selector of ['.collectionDialog', '.collectionDialogBody', '.editorDialogForm', '.editorDialogFields', '.editorDialogFoot']) {
      assert.doesNotMatch(rule(selector) ?? '', /position:\s*(absolute|fixed)/, selector);
    }
    assert.match(css, /\.toastHost,\s*\.collectionDialog \{\s*--app-background/);
    assert.match(css, /:global\(html\[data-theme='dark'\]\) \.shell,\s*:global\(html\[data-theme='dark'\]\) \.centered,[\s\S]*?:global\(html\[data-theme='dark'\]\) \.collectionDialog \{/);
    assert.match(rule('.collectionDialog') ?? '', /width: min\(560px, calc\(100vw - 32px\)\)/);
  });
});

describe('프로필 사진 (the mobile flow, the same endpoints)', () => {
  const view = source('app/(app)/me/ProfileEditView.tsx');

  it('uses PUT / DELETE /api/v1/users/me/profile/image like the mobile app', () => {
    assert.equal(PROFILE_IMAGE_PATH, '/api/v1/users/me/profile/image');
    assert.match(view, /method: 'PUT', path: PROFILE_IMAGE_PATH, body: profilePhotoForm\(pickedPhoto\)/);
    assert.match(view, /method: 'DELETE', path: PROFILE_IMAGE_PATH/);
  });

  it('accepts a JPEG / PNG / WebP of at most 5 MB and nothing else (the server checks again)', () => {
    assert.equal(isUsableProfilePhoto({ type: 'image/jpeg', size: 1000 }), true);
    assert.equal(isUsableProfilePhoto({ type: 'image/png', size: PROFILE_PHOTO_MAX_BYTES }), true);
    assert.equal(isUsableProfilePhoto({ type: 'image/webp', size: 1 }), true);
    assert.equal(isUsableProfilePhoto({ type: 'image/gif', size: 1000 }), false);
    assert.equal(isUsableProfilePhoto({ type: 'image/svg+xml', size: 1000 }), false);
    assert.equal(isUsableProfilePhoto({ type: 'image/jpeg', size: PROFILE_PHOTO_MAX_BYTES + 1 }), false);
    assert.equal(isUsableProfilePhoto({ type: 'image/jpeg', size: 0 }), false);
  });

  it('a refused photo and any other failure have the mobile words', () => {
    assert.equal(profilePhotoErrorMessage(new ApiHttpError(400, null), dictionary), dictionary.profilePhotoInvalid);
    assert.equal(profilePhotoErrorMessage(new ApiHttpError(500, null), dictionary), dictionary.profilePhotoSaveFallback);
    assert.equal(profilePhotoErrorMessage(new Error('offline'), dictionary), dictionary.profilePhotoSaveFallback);
    assert.match(dictionary.profilePhotoInvalid, /5 MB/);
  });

  it('a picked photo is only previewed until 저장; the nickname goes first, the photo second; a failure keeps the picked photo', () => {
    assert.match(view, /URL\.createObjectURL\(pickedPhoto\)/);
    assert.match(view, /URL\.revokeObjectURL/);
    assert.ok(view.indexOf("path: `${PROFILE_PATH}/display-name`") < view.indexOf('path: PROFILE_IMAGE_PATH, body'));
    assert.match(view, /updateProfile\(await api<UserProfile>\(\{ method: 'PUT', path: PROFILE_IMAGE_PATH[\s\S]*?\}\)\);\s*setPickedPhoto\(null\);/);
    assert.match(view, /setError\(profilePhotoErrorMessage\(caught, dictionary\)\)/);
  });

  it('the avatar itself and a 사진 변경 button choose; 사진 삭제 asks first for a saved photo; busy states disable everything', () => {
    assert.match(view, /styles\.profilePhotoPick/);
    assert.match(view, /dictionary\.changePhoto/);
    assert.match(view, /pickedPhoto \? removePhoto\(\) : setIsRemoveConfirmOpen\(true\)/);
    assert.match(view, /<ConfirmDialog[\s\S]*profileRemovePhotoConfirmTitle/);
    assert.match(view, /disabled=\{busy\}/);
    assert.match(view, /saving\.current/);
  });

  it('the saved profile feeds the shared profile (side bar, 내 페이지), so every avatar changes at once', () => {
    assert.match(view, /updateProfile\(updated\)/);
  });

  it('the photo strings exist for every language', () => {
    for (const key of ['profilePhotoChoose', 'profilePhotoInvalid', 'profilePhotoSaveFallback', 'profileRemovePhotoConfirmTitle', 'changePhoto', 'removePhoto'] as const) {
      assert.ok(String(dictionary[key]).length > 0, key);
    }
  });
});

describe('친구 empty state: no white strip under the wash', () => {
  it('root cause: the wash was a 96px layer on a taller surface - it now covers the whole empty state', () => {
    const empty = css.match(/\.inlineState,\s*\.emptyState \{\s*(?:\/\*[^*]*\*\/\s*)?background: ([^;]+);/g);
    assert.ok(empty, 'the identity rule exists');
    assert.doesNotMatch(empty.join('\n'), /96px/);
    assert.match(empty.join('\n'), /background: var\(--brand-wash\), var\(--app-surface\);/);
    assert.doesNotMatch(css, /var\(--brand-wash\) top \/ 100% \d+px/);
  });
});

describe('Modal / Dialog: no coloured top line', () => {
  it('no dialog, panel or picker paints the brand gradient as an edge', () => {
    for (const selector of ['.dialog', '.panelDialog', '.panelDialog .panelHeader', '.friendPickerDialog', '.reactionPicker']) {
      const body = rule(selector);
      assert.ok(body === null || !/brand-gradient|3px no-repeat/.test(body), selector);
    }
    assert.doesNotMatch(css, /brand-gradient\) top \/ 100% 3px/);
  });

  it('the scrolling structure of the dialogs is as before (shell clips, body scrolls)', () => {
    assert.match(rule('.dialog') ?? '', /overflow: hidden/);
    assert.match(rule('.dialogBody') ?? '', /overflow-y: auto/);
    assert.match(rule('.panelScroll') ?? '', /overflow-y: auto/);
  });

  it('the identity elsewhere stays: gradient logotype, active nav, primary button', () => {
    assert.match(css, /\.sidebarBrand > span \{[^}]*background: var\(--brand-gradient\)/);
    assert.match(css, /\.primaryAction,[\s\S]*?background: var\(--brand-cta\)/);
  });
});

describe('Collections Grid card: as tall as its content', () => {
  it('no reserved body height: no min-height on the Grid card, its text or its status row', () => {
    for (const selector of ['.collectionBodyGrid', '.collectionBodyGrid .collectionText', '.collectionBodyGrid .collectionName', '.collectionGridStatus']) {
      assert.doesNotMatch(rule(selector) ?? '', /min-height: (?!0)/, selector);
    }
  });

  it('the name is at most two lines (clamped), the count follows; padding is small', () => {
    const name = rule('.collectionName') ?? '';
    assert.match(name, /-webkit-line-clamp: 2/);
    assert.match(name, /overflow: hidden/);
    assert.match(rule('.collectionBodyGrid') ?? '', /padding: var\(--space-3\) var\(--space-3\) var\(--space-4\)/);
  });

  it('the status row exists only when there is something to report', () => {
    assert.equal(hasGridStatus(card()), false);
    assert.equal(hasGridStatus(card({ isFavorite: true })), false, 'the favorite star is on the cover');
    assert.equal(hasGridStatus(card({ isLocked: true })), true);
    assert.equal(hasGridStatus(card({ attentionCount: 3 })), true);
    assert.equal(hasGridStatus(card({ accessRole: 'viewer' })), true);
    assert.equal(hasGridStatus(card({ hasCollaborators: true })), true);
    assert.equal(hasGridStatus(card({ otherParticipantCount: 2, participantPreview: [{ jupleId: 'A', displayName: 'a', role: 'viewer' }] })), true);
    assert.match(source('app/(app)/collections/CollectionsView.tsx'), /hasGridStatus\(collection\) \? \(\s*<div className=\{styles\.collectionGridStatus\}>/);
  });

  it('List mode is untouched (its own classes)', () => {
    assert.match(rule('.collectionBody') ?? '', /grid-template-columns: 52px minmax\(0, 1fr\) auto/);
    assert.match(source('app/(app)/collections/CollectionsView.tsx'), /className=\{styles\.collectionBody\}/);
  });
});

describe('Collections: the selected tab is part of the address', () => {
  it('a first visit (no or an unknown value) opens on 즐겨찾기', () => {
    assert.equal(DEFAULT_COLLECTION_FILTER, 'favorites');
    for (const value of [null, undefined, '', 'bogus', 'ALL', 'owned', 'favorites ']) {
      assert.equal(parseCollectionTab(value), value === 'favorites ' ? 'favorites' : 'favorites', String(value));
    }
    assert.equal(parseCollectionTab('favorites'), 'favorites');
  });

  it('all / mine / shared are restored from the address', () => {
    assert.equal(parseCollectionTab('all'), 'all');
    assert.equal(parseCollectionTab('mine'), 'owned');
    assert.equal(parseCollectionTab('shared'), 'shared');
  });

  it('every filter round-trips through its address, keeping other parameters; the default carries none', () => {
    const base = new URL('https://dev.example/collections?x=1');
    for (const filter of COLLECTION_FILTERS) {
      assert.equal(parseCollectionTab(collectionsTabUrl(base, filter).searchParams.get('tab')), filter);
    }
    assert.equal(collectionsTabUrl(base, 'favorites').search, '?x=1');
    assert.equal(collectionsTabUrl(base, 'owned').searchParams.get('tab'), 'mine');
    assert.equal(collectionsTabUrl(base, 'all').searchParams.get('x'), '1');
    assert.equal(collectionsTabUrl(collectionsTabUrl(base, 'shared'), 'favorites').searchParams.has('tab'), false);
  });

  it('the view reads the tab from the address and writes it with router.replace (no history entries, no storage, no global state)', () => {
    const view = source('app/(app)/collections/CollectionsView.tsx');
    assert.match(view, /const filter = parseCollectionTab\(useSearchParams\(\)\.get\('tab'\)\)/);
    assert.match(view, /router\.replace\(`\$\{target\.pathname\}\$\{target\.search\}`, \{ scroll: false \}\)/);
    assert.match(view, /collectionsTabUrl\(new URL\(window\.location\.href\), next\)/);
    assert.doesNotMatch(view, /localStorage|sessionStorage|useStoredChoice\(['"A-Z_]*FILTER/);
    assert.doesNotMatch(view, /useState<CollectionFilter>/);
  });

  it('opening a Collection is an ordinary link: the history entry that holds the tab is the one Back returns to', () => {
    const view = source('app/(app)/collections/CollectionsView.tsx');
    assert.match(view, /href=\{collectionHref\(collection\.id\)\}/);
    assert.doesNotMatch(view, /router\.replace\(collectionHref/);
  });
});

describe('고객센터 문의 유형: Juple\'s own listbox, not the browser\'s <select>', () => {
  const form = source('app/(app)/me/support/new/NewInquiry.tsx');
  const popover = source('app/(app)/Popover.tsx');

  it('the form uses the shared listbox in its field look and no native select; the label points at it', () => {
    assert.doesNotMatch(form, /<select|<option/);
    assert.match(form, /<PillListbox<'' \| SupportInquiryType>[\s\S]*id=\{typeId\}[\s\S]*variant="field"/);
    assert.match(form, /htmlFor=\{typeId\}/);
  });

  it('the options are the placeholder then the seven API types, submitted by their API names', () => {
    assert.match(form, /\{ value: '', label: dictionary\.inquiryTypePlaceholder \}, \.\.\.SUPPORT_INQUIRY_TYPES\.map\(candidate => \(\{ value: candidate, label: inquiryTypeLabel\(candidate, dictionary\) \}\)\)/);
    assert.match(form, /onChange=\{next => setType\(isSupportInquiryType\(next\) \? next : null\)\}/);
    assert.match(form, /body: \{ clientRequestId: attempt\.current\.id, type, content: trimmed/);
  });

  it('it is a listbox with the full keyboard story', () => {
    for (const token of ['aria-haspopup="listbox"', 'aria-expanded={open}', 'aria-controls={open ? listId : undefined}', 'aria-activedescendant', 'role="listbox"', 'role="option"', 'aria-selected={option.value === value}']) {
      assert.ok(popover.includes(token), token);
    }
    assert.match(popover, /event\.key === 'Escape'[\s\S]*event\.stopPropagation\(\)/);
    assert.match(popover, /event\.key === 'Enter' \|\| event\.key === ' '/);
    assert.match(popover, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
    assert.match(popover, /document\.addEventListener\('pointerdown', outside, true\)/);
    assert.match(popover, /triggerRef\.current\?\.focus\(\)/);
    assert.match(css, /\.fieldSelectButton:focus-visible \{[^}]*outline: 2px solid var\(--brand\)/);
  });

  it('arrow keys move through the rows, wrapping, Home / End jump', () => {
    const none = [false, false, false];
    assert.equal(nextActiveIndex(0, 'ArrowDown', none), 1);
    assert.equal(nextActiveIndex(2, 'ArrowDown', none), 0);
    assert.equal(nextActiveIndex(0, 'ArrowUp', none), 2);
    assert.equal(nextActiveIndex(1, 'Home', none), 0);
    assert.equal(nextActiveIndex(1, 'End', none), 2);
  });

  it('the open list is a rounded Juple surface that stays inside the window and shows the chosen row', () => {
    const panel = css.slice(css.lastIndexOf('\n.floatingPanel {'), css.lastIndexOf('\n.fieldSelect .floatingPanel {'));
    assert.match(panel, /max-height: min\(320px, 60dvh\)/);
    assert.match(panel, /overflow-y: auto/);
    assert.match(popover, /Math\.max\(8, Math\.min\(top, window\.innerHeight - height - 8\)\)/);
    assert.match(popover, /Math\.max\(8, Math\.min\(left, window\.innerWidth - width - 8\)\)/);
    assert.match(popover, /<Glyph className=\{styles\.floatingCheck\} name="Check"/);
    assert.match(css, /\.floatingRow\[aria-selected='true'\] \{[^}]*background/);
    assert.match(rule('.fieldSelect .floatingRow') ?? '', /min-height: 44px/);
    // all eight rows fit without an inner scrollbar on a normal window (8 x 44px + gaps), a short window scrolls inside
    assert.match(rule('.fieldSelect .floatingPanel') ?? '', /max-height: min\(400px, 60dvh\)/);
  });
});
