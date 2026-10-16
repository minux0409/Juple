import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Regression tests for the DEV browser QA round: each bug was reproduced first (in the real app, signed in through a faked Entra
// response, with mocked API answers) and these pin the cause that was found - not just the look.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = source('app/(app)/app.module.css');
const rule = (selector: string) => {
  // The rule whose selector is exactly this - not the last line of a grouped selector (whose previous line ends with a comma).
  let start = css.indexOf(`\n${selector} {`);
  while (start > 0 && css.slice(0, start).trimEnd().endsWith(',')) {
    start = css.indexOf(`\n${selector} {`, start + 1);
  }
  assert.ok(start >= 0, selector);
  return css.slice(start, css.indexOf('\n}', start));
};

describe('1. collaboration in a shared Collection link', () => {
  const section = source('app/(app)/ItemCollaboration.tsx');

  it("another member's link: both its Quick Detail and its standalone page mount the section with the Collection's id", () => {
    for (const file of ['SharedItemContent.tsx', 'SharedItemView.tsx']) {
      const view = source(`app/(app)/collections/[collectionId]/items/[itemId]/${file}`);
      assert.match(view, /const \{ collectionId, state, reload \} = useSharedItem\(collectionIdParam, itemIdParam\);|const \{ collectionId, state, reload \} = useSharedItem/);
      assert.match(view, /<ItemCollaboration always collectionId=\{collectionId\} itemId=\{item\.itemId\} row=\{item\} \/>/, file);
    }
    // ...and the Quick Detail is the intercepted route that renders that content.
    assert.match(source('app/(app)/@modal/(.)collections/[collectionId]/items/[itemId]/page.tsx'), /<SharedItemQuickContent collectionIdParam=\{collectionId\} itemIdParam=\{itemId\} \/>/);
  });

  it("another member's link never waits for the Owner-only collaborator flag (a member is never told hasCollaborators)", () => {
    assert.match(section, /const collaborative = context !== null && \(always \|\| context\.collaborative\);/);
    // A failed Collection read still shows the section for another member's link.
    assert.match(section, /setContext\(always \? \{ isOwner: false, collaborative: true \} : null\);/);
  });

  it('with no comments the section still offers a reaction, the empty state and the composer', () => {
    assert.match(section, /data-reaction-add/);
    assert.match(section, /status === 'ready' && comments\.length === 0 \? <p className=\{styles\.commentState\}>\{dictionary\.commentsEmpty\}<\/p>/);
    assert.match(section, /<CommentComposer/);
  });
});

describe('2. a solo Owner\'s share screen', () => {
  const view = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');

  it('participants are read whenever the share screen is open - not only for a collaborative Collection', () => {
    assert.match(view, /const wantsParticipants = loadedCollection !== null && \(isCollaborative\(loadedCollection\) \|\| panel === 'share'\);/);
    assert.match(view, /api<CollectionParticipants>\(\{ path: `\$\{collectionPath\(loadedCollectionId\)\}\/participants` \}\)/);
    // The old header-only read (collaborative Collections only) is gone: nothing else gates the request.
    assert.doesNotMatch(view, /if \(isCollaborative\(collection\)\) \{\s*api<CollectionParticipants>/);
  });

  it('a failed read ends the waiting too (the share screen shows its failure, never an endless skeleton)', () => {
    assert.match(view, /setParticipantsFailed\(true\);/);
    const sharing = source('app/(app)/collections/[collectionId]/CollectionSharing.tsx');
    assert.match(sharing, /\{!participants && !participantsFailed \? <SettingsRowSkeleton count=\{3\} \/> : null\}/);
  });
});

describe('3. selectable chips: one border, no movement', () => {
  it('both states share ONE 1px solid border; selected changes only its colour (never the browser\'s 2px outset button border)', () => {
    const group = rule('.filterTab,\n.filterTabSelected');
    assert.match(group, /box-sizing: border-box;/);
    assert.match(group, /border: 1px solid transparent;/);
    assert.match(group, /padding: 0 16px;/);
    const selected = rule('.filterTabSelected');
    assert.match(selected, /border-color: var\(--brand\);/);
    assert.doesNotMatch(selected, /border(-width|-style)?:|padding|transform|inset|outset/);
    assert.doesNotMatch(rule('.filterTab'), /border|padding/);
  });

  it("the sort arrow's room is kept on the unselected chip too, so selecting never resizes a chip or moves its neighbour", () => {
    const chips = source('app/(app)/SortChips.tsx');
    assert.equal((chips.match(/className=\{(?:!?timeSelected) \? styles\.sortArrow : styles\.sortArrowHidden\}/g) ?? []).length, 2);
    assert.doesNotMatch(chips, /\? <span aria-hidden className=\{styles\.sortArrow\}>/);
    assert.match(rule('.sortArrow,\n.sortArrowHidden'), /display: inline-block;\s*width: 1em;/);
    assert.match(rule('.sortArrowHidden'), /visibility: hidden;/);
  });

  it('the list / grid / image switch already shared its border - it stays that way', () => {
    assert.match(rule('.toggleButton,\n.toggleButtonSelected'), /border: 1px solid transparent;/);
  });
});

describe('4. loading skeletons follow the chosen view, for either sort', () => {
  it('이름순 (the whole Collection), 시간순 (its date sections) and the first load all draw the current view mode', () => {
    const view = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
    assert.match(view, /if \(state\.kind === 'loading'\) \{\s*return <SavedLinkSkeleton count=\{6\} mode=\{viewMode\} \/>;/);
    assert.match(view, /<CollectionHeaderSkeleton \/>[\s\S]{0,160}<SavedLinkSkeleton count=\{4\} mode=\{viewMode\} \/>/);
    assert.match(source('app/(app)/DateSections.tsx'), /if \(sectionsState\.kind === 'loading'\) \{[\s\S]{0,120}return <SavedLinkSkeleton count=\{4\} mode=\{viewMode\} \/>;/);
    assert.doesNotMatch(view + source('app/(app)/DateSections.tsx'), /<SavedLinkSkeleton count=\{\d\} mode="list" \/>/);
  });

  it('a sort switch remounts the list (its own loading state); the next page keeps the paging skeleton, not the whole list', () => {
    const view = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
    assert.match(view, /key=\{`name-\$\{sort\}-\$\{contentToken\}`\}/);
    assert.match(view, /key=\{`\$\{sort\}-\$\{contentToken\}`\}/);
    assert.match(source('app/(app)/DateSections.tsx'), /skeleton=\{<SavedLinkSkeleton count=\{skeletonCount\(section, page\.items\.length\)\} mode=\{viewMode\} \/>\}/);
  });
});

describe('5. titles people wrote, in Han / Kanji', () => {
  it('the font stack keeps Latin first and adds each platform\'s CJK system fonts (no web font, nothing downloaded)', () => {
    const globals = source('app/globals.css');
    const stack = globals.slice(globals.indexOf('font-family:'), globals.indexOf(';', globals.indexOf('font-family:')));
    assert.match(stack, /^font-family:\s*-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,\s/);
    for (const family of ["'Apple SD Gothic Neo'", "'Noto Sans KR'", "'Malgun Gothic'", "'Hiragino Sans'", "'Yu Gothic UI'", "'PingFang SC'", "'Microsoft YaHei UI'", "'Microsoft JhengHei UI'", "'Noto Sans CJK JP'"]) {
      assert.ok(stack.includes(family), family);
    }
    assert.match(stack, /sans-serif$/);
    assert.doesNotMatch(globals + css, /@font-face|@import|fonts\.googleapis/);
  });

  it('link titles and notification words are 600 and never a synthesized bold; the app headings keep their weight', () => {
    assert.match(rule('.quickTitle'), /font-weight: 600;/);
    assert.match(rule('.itemTitle'), /font-weight: 600;/);
    assert.match(rule('.linkTitle'), /font-weight: 600;/);
    assert.match(css, /\.notificationBodyUnread \{\s*font-weight: 600;\s*\}/);
    assert.match(css, /\.quickTitle,\n\.itemTitle,\n\.linkTitle,\n\.notificationBody,\n\.notificationBodyUnread \{\n  font-synthesis-weight: none;\n\}/);
    assert.match(rule('.pageTitle'), /font-weight: 800;/);
  });
});

describe('6. 계정 > 비밀번호 재설정 reads like the rows beside it', () => {
  it('the same row box and label as 로그인 방식 / 이메일; the action only adds the reset, pointer and hover', () => {
    const account = source('app/(app)/me/MyPageSections.tsx');
    assert.match(account, /<button className=\{`\$\{styles\.settingsRow\} \$\{styles\.settingsRowAction\}`\} onClick=\{\(\) => reauthenticate\('passwordReset'\)\} type="button">\s*<span className=\{styles\.settingsLabel\}>\{dictionary\.accountPasswordReset\}<\/span>/);
    const section = account.slice(account.indexOf('export function AccountSection'));
    assert.equal((section.match(/<span className=\{styles\.settingsLabel\}>/g) ?? []).length, 3);
    const action = rule('.settingsRowAction');
    assert.doesNotMatch(action, /font-size|font-weight|line-height|padding|min-height/);
    assert.match(action, /font: inherit;/);
    assert.match(action, /cursor: pointer;/);
    assert.match(css, /\.settingsCard > \* \+ \.settingsRowAction \{\s*border-top: 1px solid var\(--app-divider\);/);
  });
});
