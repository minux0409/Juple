import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { canEditCollection } from '../lib/collectionEditor.ts';
import { STATUS_ICON_MARKUP } from '../lib/collectionIconMarkup.ts';
import { canShareCollection, participantsWithSelf } from '../lib/collectionSharing.ts';
import { adderViewOf, collectionLinkView, collectionShareHref, historyLinkView, shouldShowLinkAdders, type CollectionItemEntry } from '../lib/savedLinks.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = source('app/(app)/app.module.css');
const list = source('app/(app)/SavedLinkList.tsx');

const collectionEntry = (overrides: Partial<CollectionItemEntry> = {}): CollectionItemEntry => ({
  itemId: 7,
  url: 'https://a.test/x',
  title: 't',
  memo: null,
  addedAtUtc: '2026-10-10T00:00:00Z',
  representativeImage: null,
  previewImageUrl: null,
  coverImage: null,
  ...overrides,
});

describe('Product polish 1: saved links show no time, List / Grid open the original page', () => {
  it('a card / row draws no saved time (Item Details has it); the date section headers are untouched', () => {
    assert.doesNotMatch(list, /<time\b/);
    assert.doesNotMatch(list, /timestampOf|formatLinkTimestamp/);
    for (const path of ['app/(app)/HomeView.tsx', 'app/(app)/archive/ArchiveView.tsx', 'app/(app)/DateSections.tsx', 'app/(app)/collections/[collectionId]/CollectionDetailsView.tsx']) {
      assert.doesNotMatch(source(path), /timestampOf/, path);
    }
    assert.match(source('app/(app)/DateSections.tsx'), /sectionLabel\(section, dictionary, locale\)/);
  });

  it('the 바로가기 button is List and Grid only (never the 9-column image view), a sibling of the card link, with a label', () => {
    assert.match(list, /mode !== 'image' && link\.externalUrl/);
    assert.match(list, /aria-label=\{dictionary\.openLink\}/);
    assert.match(list, /href=\{link\.externalUrl\}\s*rel="noopener noreferrer"\s*target="_blank"/);
    // the open button is rendered after (beside) the link/div, not inside it
    assert.ok(list.indexOf('{open}') > list.indexOf('</Link>'));
    assert.match(css, /\.linkOpen \{[^}]*position: absolute;[^}]*width: 40px;[^}]*height: 40px;/);
    // List reserves room for it; Grid keeps its meta line clear of it
    assert.match(css, /\.linkList \.linkRowBody \{[^}]*padding-inline-end: calc\(40px \+ var\(--space-3\)\);/);
    assert.match(css, /\.linkGrid \.cardBody \.linkMeta \{[^}]*padding-inline-end: 36px;/);
  });

  it('the external URL is the saved http(s) URL only; a locked or unsafe one has none', () => {
    assert.equal(historyLinkView({ id: 1, url: 'https://a.test/p?q=1', title: 'T', memo: null, savedAtUtc: '2026-10-12T01:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null }).externalUrl, 'https://a.test/p?q=1');
    assert.equal(historyLinkView({ id: 1, url: 'javascript:alert(1)', title: 'T', memo: null, savedAtUtc: '2026-10-12T01:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null }).externalUrl, null);
    assert.equal(historyLinkView({ id: 1, url: '', title: null, memo: null, savedAtUtc: '2026-10-12T01:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null, isCollectionLocked: true, collectionId: 3 }).externalUrl, null);
    assert.equal(collectionLinkView(collectionEntry(), 12).externalUrl, 'https://a.test/x');
    // another member's link keeps its own page (the shared view) and still offers the saved original
    const theirs = collectionLinkView(collectionEntry({ isMine: false }), 12);
    assert.equal(theirs.href, '/collections/12/items/7');
    assert.equal(theirs.externalUrl, 'https://a.test/x');
  });
});

describe('Product polish 1: Collections card actions follow the person\'s real permission', () => {
  const card = source('app/(app)/collections/CollectionsView.tsx');

  it('favorite for everyone, share only for the Owner, edit only for the Owner; a locked Collection needs its own page first', () => {
    assert.equal(canShareCollection({ accessRole: 'owner' }, null), true);
    assert.equal(canShareCollection({ accessRole: undefined }, null), true);
    for (const role of ['contributor', 'viewer', 'submitter'] as const) {
      assert.equal(canShareCollection({ accessRole: role }, null), false, role);
      assert.equal(canEditCollection({ accessRole: role }), false, role);
    }
    assert.match(card, /const open = !isCollectionLocked\(collection\);/);
    assert.match(card, /const canShare = open && canShareCollection\(collection, null\);/);
    assert.match(card, /const canEdit = open && canEditCollection\(collection\);/);
    assert.match(card, /\{canShare \? \(/);
    assert.match(card, /\{canEdit \? \(/);
  });

  it('the actions are siblings of the card link (a click never opens the Collection) and carry labels', () => {
    assert.match(card, /<CollectionCardBody[^>]*\/>\s*\{actions\}/);
    assert.match(card, /aria-label=\{favoriteLabel\}\s*aria-pressed=\{collection\.isFavorite\}/);
    assert.match(card, /aria-label=\{dictionary\.shareAction\}/);
    assert.match(card, /aria-label=\{dictionary\.collectionEdit\}/);
    assert.equal(collectionShareHref(5), '/collections/5?panel=share');
    assert.match(source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx'), /get\('panel'\) === 'share'/);
    assert.match(source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx'), /open=\{panel === 'share' && canShareCollection\(collection, memberShareUrl\)\}/);
  });

  it('the favorite toggle is optimistic, rolls back, and takes an un-favorited card out of 즐겨찾기', () => {
    assert.match(card, /method: 'PUT', path: `\$\{collectionPath\(collection\.id\)\}\/favorite`/);
    assert.match(card, /filter === 'favorites' && !replacement\.isFavorite \? \[\]/);
    assert.match(card, /toast\.showNotice\(dictionary\.errorFavorite, 'error'\)/);
  });

  it('Grid shows them on hover / focus (always on touch); List keeps them in the row\'s own end cell', () => {
    assert.match(css, /@media \(hover: hover\) \{\s*\.collectionActionsGrid \{\s*opacity: 0;/);
    assert.match(css, /\.collectionCard:focus-within \.collectionActionsGrid \{\s*opacity: 1;/);
    assert.match(css, /\.collectionList > \.collectionCard > \.collectionActions \{/);
  });
});

describe('Product polish 1: new Collection from the link editor', () => {
  it('Item Edit hands the picker onCreated: offered at once, chosen for the link, nothing duplicated', () => {
    const edit = source('app/(app)/items/[itemId]/edit/ItemEditView.tsx');
    assert.match(edit, /onCreated=\{created => \{/);
    assert.match(edit, /setDestinations\(previous => \[created, \.\.\.\(previous \?\? \[\]\)\.filter\(entry => entry\.id !== created\.id\)\]\)/);
    assert.match(edit, /base\.some\(entry => entry\.id === created\.id\) \? base : \[\.\.\.base, created\]/);
    // the picker owns the create request and its validation (the same one the Collections page uses) - not duplicated here
    assert.doesNotMatch(edit, /createCollection\(/);
    assert.match(source('app/(app)/CollectionPicker.tsx'), /createCollection/);
  });
});

describe('Product polish 1: dialog and side bar', () => {
  it('the lock-removal dialog is one padded column with a gap scale; its sentence wraps inside', () => {
    assert.match(source('app/(app)/collections/[collectionId]/CollectionManagementDialogs.tsx'), /<form className=\{styles\.modalForm\} noValidate onSubmit=\{removeLock\}>/);
    assert.match(css, /\.modalForm \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*gap: var\(--space-3\);[^}]*padding: var\(--space-4\) var\(--space-5\) var\(--space-5\);/);
    assert.match(css, /\.modalForm \.dialogMessage,[^{]*\{[^}]*margin: 0;[^}]*overflow-wrap: anywhere;/);
  });

  it('the active side-bar item is a flat tint with an accent - no gradient - from semantic tokens, with hover and focus apart', () => {
    const active = css.slice(css.indexOf('.navLinkActive {\n  background: var(--nav-active-bg)') >= 0 ? css.indexOf('.navLinkActive {\n  background: var(--nav-active-bg)') : css.indexOf('.navLinkActive {\r\n  background: var(--nav-active-bg)'));
    const block = active.slice(0, active.indexOf('.pageTitleIcon'));
    assert.ok(block.length > 0);
    assert.doesNotMatch(block, /--brand-gradient|--juple-coral|--juple-violet/);
    assert.match(block, /var\(--nav-active-bg\)/);
    assert.match(block, /var\(--nav-active-indicator\)/);
    assert.match(block, /\.navLink:hover \{\s*background: var\(--nav-hover-bg\);/);
    assert.match(block, /\.navLink:focus-visible,\s*\.navLinkActive:focus-visible \{\s*outline: 2px solid var\(--nav-focus-ring\);/);
    assert.match(css, /--nav-active-bg: #[0-9a-f]{6};/);
  });
});

describe('Product polish 1: Owner crown on the avatar, adders in shared Collections', () => {
  const me = { jupleId: 'ME000001', displayName: 'Me', profileImageUrl: null };
  const owner = { jupleId: 'OW000001', displayName: 'Owner', role: 'owner', profileImageUrl: null };
  const member = { jupleId: 'MB000001', displayName: 'Member', role: 'contributor', profileImageUrl: null };

  it('the caller is one of the participant circles; the Owner (when it is me) leads, with the Owner role', () => {
    assert.deepEqual(participantsWithSelf([member], 'owner', me).map(p => [p.jupleId, p.role]), [['ME000001', 'owner'], ['MB000001', 'contributor']]);
    assert.deepEqual(participantsWithSelf([owner, member], 'contributor', me).map(p => [p.jupleId, p.role]), [['OW000001', 'owner'], ['MB000001', 'contributor'], ['ME000001', 'contributor']]);
    assert.deepEqual(participantsWithSelf([owner], 'viewer', me).at(-1)?.isMe, true);
    // already there, or an unknown profile: unchanged, nothing invented
    assert.equal(participantsWithSelf([{ ...me, role: 'owner', isMe: true }, member], 'owner', me).length, 2);
    assert.deepEqual(participantsWithSelf([member], 'owner', null), [member]);
  });

  it('no crown beside any Collection name; the avatar carries it (role owner only)', () => {
    assert.doesNotMatch(source('app/(app)/collections/CollectionsView.tsx'), /Crown/);
    assert.doesNotMatch(source('app/(app)/collections/[collectionId]/CollectionSharing.tsx'), /name="Crown"/);
    assert.match(source('app/(app)/Avatar.tsx'), /person\.role === 'owner' \? \(/);
    assert.match(source('app/(app)/collections/CollectionsView.tsx'), /participantsWithSelf\(known, collection\.accessRole \?\? 'owner', profile\)/);
  });

  it('a link\'s adder is shown only in a shared Collection; its Owner gets the crown (also when it is me)', () => {
    assert.equal(shouldShowLinkAdders({ accessRole: 'owner', hasCollaborators: false, isPublicShareActive: false }, []), false, 'personal');
    assert.equal(shouldShowLinkAdders({ accessRole: 'owner', hasCollaborators: true }, []), true);
    assert.equal(shouldShowLinkAdders({ accessRole: 'viewer' }, []), true);
    assert.equal(shouldShowLinkAdders({ accessRole: 'owner' }, [{ addedBy: { kind: 'publicLink' } }]), true);
    const personal = collectionLinkView(collectionEntry({ addedBy: { kind: 'me', jupleId: 'ME000001', displayName: 'Me' } }), 3, { showAdder: false });
    assert.equal(personal.adder, null);
    const mine = collectionLinkView(collectionEntry({ addedBy: { kind: 'me', jupleId: 'ME000001', displayName: 'Me', isCollectionOwner: true } }), 3, { showAdder: true });
    assert.deepEqual(mine.adder, { kind: 'person', name: 'Me', profileImageUrl: null, isCollectionOwner: true, isMe: true });
    assert.equal(adderViewOf({ kind: 'owner', jupleId: 'OW000001', displayName: 'Owner' })?.kind === 'person' && adderViewOf({ kind: 'owner', jupleId: 'OW000001' })?.kind, 'person');
    const ownerAdder = adderViewOf({ kind: 'owner', jupleId: 'OW000001', displayName: 'Owner' });
    assert.equal(ownerAdder?.kind === 'person' && ownerAdder.isCollectionOwner, true);
    const memberAdder = adderViewOf({ kind: 'member', jupleId: 'MB000001', displayName: ' Member ', profileImageUrl: 'https://img.test/p.png' });
    assert.deepEqual(memberAdder, { kind: 'person', name: 'Member', profileImageUrl: 'https://img.test/p.png', isCollectionOwner: false, isMe: false });
    assert.deepEqual(adderViewOf({ kind: 'publicLink' }), { kind: 'publicLink' });
    assert.equal(adderViewOf({ kind: 'member' }), null, 'no identity: no invented face');
    assert.equal(adderViewOf(null), null);
    assert.equal((adderViewOf({ kind: 'member', jupleId: 'MB000001', profileImageUrl: 'javascript:alert(1)' }) as { profileImageUrl: string | null }).profileImageUrl, null);
  });

  it('the adder avatar is drawn with the Owner role (crown on the corner) and named for assistive technology; not in the image view', () => {
    assert.match(list, /role: adder\.isCollectionOwner \? 'owner' : null/);
    assert.match(list, /aria-label=\{full\}/);
    assert.match(list, /\{mode === 'list' \|\| !\(hasMeta\(link\) \|\| link\.externalUrl\) \? null : \(/);
    // the image view's body has no meta at all
    assert.match(list, /mode === 'image' \? \(/);
  });
});

describe('Product polish 1: friend actions have icons and keep their labels', () => {
  const friends = source('app/(app)/me/friends/page.tsx');
  const row = friends.slice(friends.indexOf('function FriendRow'));

  it('메모 / 신고 / 차단 / 친구 삭제: an icon and the word, in the shared icon family', () => {
    for (const glyph of ['Edit', 'Flag', 'Block', 'UserMinus']) {
      assert.ok(glyph in STATUS_ICON_MARKUP, glyph);
    }
    assert.match(row, /<Glyph name="Edit" size=\{16\} \/>\s*\{dictionary\.friendsNote\}/);
    assert.match(row, /<Glyph name="Flag" size=\{16\} \/>\s*\{dictionary\.safetyReport\}/);
    assert.match(row, /<Glyph name="Block" size=\{16\} \/>\s*\{dictionary\.safetyBlock\}/);
    assert.match(row, /<Glyph name="UserMinus" size=\{16\} \/>\s*\{dictionary\.friendsRemove\}/);
  });

  it('removal and block are destructive, report is a warning, the memo is neutral', () => {
    assert.match(row, /className=\{styles\.dangerAction\} data-friend-block/);
    assert.match(row, /className=\{styles\.dangerAction\} data-friend-remove/);
    assert.match(row, /className=\{`\$\{styles\.settingsAction\} \$\{styles\.warningAction\}`\} data-friend-report/);
    assert.match(row, /className=\{styles\.settingsAction\} disabled=\{busy \|\| saving\}/);
    assert.match(css, /\.warningAction \{[^}]*color: var\(--warning-text\);/);
  });
});
