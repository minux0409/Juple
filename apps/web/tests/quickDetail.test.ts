import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = source('app/(app)/app.module.css');

describe('Quick Detail sheet: routes', () => {
  it('a parallel @modal slot with an intercepting (.)items/[itemId] route; every other address closes it; nothing open is the default', () => {
    for (const file of ['@modal/default.tsx', '@modal/[...catchAll]/page.tsx', '@modal/(.)items/[itemId]/page.tsx']) {
      assert.ok(existsSync(new URL(`../app/(app)/${file}`, import.meta.url)), file);
    }
    assert.match(source('app/(app)/@modal/default.tsx'), /return null;/);
    assert.match(source('app/(app)/@modal/[...catchAll]/page.tsx'), /return null;/);
    const layout = source('app/(app)/layout.tsx');
    assert.match(layout, /\{ children, modal \}: \{ children: React\.ReactNode; modal: React\.ReactNode \}/);
    assert.match(layout, /\{children\}\s*\{modal\}\s*<\/AppRoot>/);
  });

  it('the standalone page stays: /items/[itemId] still renders ItemDetailsView; the intercepted route renders the sheet with the same context', () => {
    assert.match(source('app/(app)/items/[itemId]/page.tsx'), /<ItemDetailsView/);
    const intercepted = source('app/(app)/@modal/(.)items/[itemId]/page.tsx');
    assert.match(intercepted, /<QuickDetailSheet fromCollectionId=\{fromCollectionId\} itemIdParam=\{itemId\}/);
    assert.match(intercepted, /parseLockedContext\(typeof search\.lockedBy === 'string' \? search\.lockedBy : null\)/);
    assert.match(intercepted, /parseLockedContext\(typeof search\.collectionId === 'string' \? search\.collectionId : null\)/);
    assert.match(intercepted, /if \(parseRouteId\(itemId\) === null\) \{\s*return <NotAnItem \/>;/, '/items/new is not a link');
  });

  it('both presentations share ONE content component', () => {
    assert.match(source('app/(app)/items/[itemId]/ItemDetailsView.tsx'), /<ItemDetailContent /);
    assert.match(source('app/(app)/items/[itemId]/QuickDetailSheet.tsx'), /<ItemDetailContent /);
    assert.doesNotMatch(source('app/(app)/items/[itemId]/ItemDetailsView.tsx') + source('app/(app)/items/[itemId]/QuickDetailSheet.tsx'), /useItemRecord|api<|DELETE/);
  });
});

describe('Quick Detail sheet: behaviour', () => {
  const sheet = source('app/(app)/items/[itemId]/QuickDetailSheet.tsx');

  it('a native modal dialog: inert page behind, focus kept inside, Escape / backdrop / close go back one history entry', () => {
    assert.match(sheet, /dialog\.showModal\(\)/);
    assert.match(sheet, /onCancel=\{event => \{\s*event\.preventDefault\(\);\s*close\(\);/);
    assert.match(sheet, /event\.target === event\.currentTarget/);
    assert.match(sheet, /const close = \(\) => router\.back\(\);/);
    assert.match(sheet, /aria-label=\{dictionary\.close\}/);
    assert.match(sheet, /aria-label=\{dictionary\.itemDetailsTitle\}/);
    assert.doesNotMatch(sheet, /router\.(push|replace)|window\.history\.(push|replace)State/, 'closing never creates history');
  });

  it('while it is open the page underneath keeps its visit: the Collection grant is not forgotten when the address names the link', () => {
    assert.match(sheet, /setItemOverlayOpen\(true\);\s*return \(\) => setItemOverlayOpen\(false\);/);
    const shell = source('app/(app)/AppShell.tsx');
    assert.match(shell, /if \(isItemOverlayOpen\(\)\) \{\s*return;\s*\}\s*forgetUnlocksOutside\(pathname\);/);
  });

  it('the details keep every rule: owner page read, 수정 -> the editor route, 삭제 / 컬렉션에서 삭제 with the visit grant, a locked card asks its password', () => {
    const content = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(content, /itemEditHref\(itemId, search\)/);
    assert.match(content, /api<void>\(\{ method: 'DELETE', path: `\/api\/v1\/items\/\$\{itemId\}` \}\)/);
    assert.match(content, /method: 'DELETE', path: `\/api\/v1\/collections\/\$\{fromCollectionId\}\/items\/\$\{itemId\}`, headers: unlockHeaders\(fromCollectionId\)/);
    assert.match(content, /state\.kind === 'gated' && lockedBy !== null && itemId !== null\) \{\s*return <GatedLink/);
    assert.doesNotMatch(content, /\/permanent/);
    assert.match(content, /\{item\.memo\?\.trim\(\) \? \(/, 'the memo only when it is written (nothing invented)');
    assert.match(content, /<QuickThumb dictionary=\{dictionary\} photoKey=\{photoKey\} photoUrl=\{hasImage \? photoUrl : null\} siteId=\{siteId\} \/>/, 'the picture only when there is one');
    assert.match(content, /return photoUrl !== null \? \(\s*<div className=\{styles\.quickThumb\}>/);
  });

  it('after 삭제 the lists under the sheet read themselves again; 수정 goes back to the details and tells them too', () => {
    assert.match(source('app/(app)/items/[itemId]/ItemDetailContent.tsx'), /setConfirming\(false\);[\s\S]*?notifyItemsChanged\([\s\S]*?\);\s*onLeave\(\);/);
    for (const file of ['HomeView.tsx', 'archive/ArchiveView.tsx', 'DateSections.tsx', 'collections/[collectionId]/CollectionDetailsView.tsx']) {
      assert.match(source(`app/(app)/${file}`), /useItemsChanged\(change =>/, file);
    }
    const editor = source('app/(app)/items/[itemId]/edit/ItemEditView.tsx');
    assert.match(editor, /if \(itemId !== null\) \{\s*notifyItemsChanged\(\{ kind: 'updated', itemId \}\);\s*\}\s*if \(takeEditOpenedFromDetails\(\)\) \{\s*router\.back\(\);\s*\} else \{\s*window\.location\.replace\(detailsHref\);/);
    assert.match(source('app/(app)/items/[itemId]/ItemDetailContent.tsx'), /markEditOpenedFromDetails\(\);/);
  });

  it('the signal and the overlay flag are plain in-memory modules (nothing stored, nothing sent)', async () => {
    const changes = await import('../lib/itemChanges.ts');
    let heard = 0;
    const off = changes.subscribeItemsChanged(() => void (heard += 1));
    changes.notifyItemsChanged({ kind: 'updated', itemId: 1 });
    off();
    changes.notifyItemsChanged({ kind: 'updated', itemId: 1 });
    assert.equal(heard, 1);
    const overlay = await import('../lib/itemOverlay.ts');
    assert.equal(overlay.isItemOverlayOpen(), false);
    overlay.setItemOverlayOpen(true);
    assert.equal(overlay.isItemOverlayOpen(), true);
    overlay.setItemOverlayOpen(false);
    assert.equal(overlay.takeEditOpenedFromDetails(), false);
    overlay.markEditOpenedFromDetails();
    assert.equal(overlay.takeEditOpenedFromDetails(), true);
    assert.equal(overlay.takeEditOpenedFromDetails(), false, 'read once');
    assert.doesNotMatch(source('lib/itemChanges.ts') + source('lib/itemOverlay.ts'), /localStorage|sessionStorage|fetch\(|document\.cookie/);
  });
});

describe('Quick Detail sheet: size and responsiveness', () => {
  it('desktop: a floating bottom-centred panel, clamp(720px, 60vw, 900px), max 82vh, 28px radius, slide-up, dimmed backdrop', () => {
    assert.match(css, /\.quickSheet\[open\] \{\s*display: flex;\s*align-items: flex-end;\s*justify-content: center;/);
    assert.match(css, /\.quickPanel \{[^}]*width: clamp\(720px, 60vw, 900px\);[^}]*max-height: 82vh;[^}]*border-radius: 28px;[^}]*animation: quickRise/);
    assert.match(css, /\.quickSheet::backdrop \{\s*background: var\(--scrim, rgba\(15, 23, 42, 0\.45\)\);/);
    assert.match(css, /\.quickScroll \{[^}]*overflow-y: auto;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none;/);
  });

  it('tablet below 1180px: calc(100vw - 48px) up to 820px; phone below 860px: full-width bottom sheet, top radius, max 90vh', () => {
    assert.match(css, /@media \(max-width: 1179px\) \{\s*\.quickPanel \{\s*width: calc\(100vw - 48px\);\s*max-width: 820px;/);
    assert.match(css, /@media \(max-width: 859px\) \{\s*\.quickSheet\[open\] \{\s*padding: 0;\s*\}\s*\.quickPanel \{\s*width: 100%;[^}]*max-height: 90vh;[^}]*border-radius: 24px 24px 0 0;/);
  });

  it('the link actions are one vertical icon-only stack beside the name (링크 열기, 수정, 삭제 / 컬렉션에서 제거) - no action footer', () => {
    const content = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    const stack = content.slice(content.indexOf('className={styles.quickActions}'), content.indexOf('</div>', content.indexOf('className={styles.quickActions}')));
    const open = stack.indexOf('name="ExternalLink"');
    const edit = stack.indexOf('name="Edit"');
    const remove = stack.indexOf('name="Trash"');
    assert.ok(open > 0 && open < edit && edit < remove, 'order: open, edit, then the destructive action');
    // icon-only, each named for assistive technology and with a tooltip
    assert.match(stack, /aria-label=\{dictionary\.openLink\}[^>]*title=\{dictionary\.openLink\}/);
    assert.match(stack, /aria-label=\{dictionary\.edit\}[\s\S]*?title=\{dictionary\.edit\}/);
    assert.match(stack, /aria-label=\{removeFromCollection \? dictionary\.removeFromCollectionAction : dictionary\.delete\}[\s\S]*?title=\{removeFromCollection \? dictionary\.removeFromCollectionAction : dictionary\.delete\}/);
    assert.doesNotMatch(stack, /\{dictionary\.(openLink|edit|delete|removeFromCollection)\}\s*</, 'no visible text in the buttons');
    // the context decides what the destructive action does - unchanged: a Collection membership, never the link itself, there
    assert.match(content, /const request = removeFromCollection\s*\? api<void>\(\{ method: 'DELETE', path: `\/api\/v1\/collections\/\$\{fromCollectionId\}\/items\/\$\{itemId\}`/);
    assert.match(content, /<ConfirmDialog[\s\S]*?destructive[\s\S]*?onConfirm=\{run\}/);
    assert.match(stack, /href=\{itemEditHref\(itemId, search\)\}/);
    // no second set of the same actions
    assert.doesNotMatch(content, /quickFooter|OpenLinkButton/);
    assert.doesNotMatch(css, /\.quickFooter|\.quickOpenIcon/);
    assert.match(css, /\.quickActions \{\s*display: flex;\s*flex: 0 0 44px;\s*flex-direction: column;\s*gap: 8px;/);
    assert.match(css, /\.quickActionButton,\s*\.quickActionDanger \{[^}]*width: 44px;[^}]*height: 44px;/);
    assert.equal(getAppDictionary('ko').removeFromCollectionAction, '컬렉션에서 제거');
  });

  it('the standalone page is a compact centred column (no 7:5 workspace)', () => {
    assert.match(css, /\.quickPage \{[^}]*max-width: 1040px;[^}]*margin-inline: auto;/);
    assert.doesNotMatch(source('app/(app)/items/[itemId]/ItemDetailsView.tsx'), /detailWorkspace/);
  });
});

describe('새 링크 검토 (/items/new) is never a Quick Detail sheet', () => {
  const urls = [
    'https://youtu.be/abcDEF12345?t=10&si=xyz',
    'https://www.youtube.com/watch?v=abcDEF12345&list=PL1&t=42s',
    'https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=MTIz&utm_source=ig_web',
    'https://www.instagram.com/p/C1a2B3c4D5e/?img_index=2',
    'https://example.com/a/b?x=1&y=two words#frag',
  ];

  it('opening the review is a full page navigation to /items/new with the whole link in the query, for every kind of link', async () => {
    const { openReview, reviewHref, normalizeEnteredUrl } = await import('../lib/newLink.ts');
    for (const url of urls) {
      const assigned: string[] = [];
      const href = openReview(url, target => void assigned.push(target));
      assert.deepEqual(assigned, [href], url);
      const parsed = new URL(`http://x${href}`);
      assert.equal(parsed.pathname, '/items/new');
      assert.equal(parsed.searchParams.get('url'), url, 'the whole query string of the link survives');
      assert.equal(href, reviewHref(url));
      assert.equal(normalizeEnteredUrl(`  ${url}  `), url, 'pasted with spaces');
    }
    // A link pasted inside other text is still found (Enter and Save share the same check).
    assert.equal(normalizeEnteredUrl(`look at this ${urls[2]} :)`), urls[2]);
    assert.equal(normalizeEnteredUrl('not a link'), null);
  });

  it('Home: Enter and the Save button are the SAME submit, and it opens the review with a full navigation (never router.push)', () => {
    const home = source('app/(app)/HomeView.tsx');
    const form = home.slice(home.indexOf('function AddLinkForm'));
    assert.match(form, /<form className=\{styles\.addLinkPanel\} noValidate onSubmit=\{submit\}>/, 'Enter submits the form');
    assert.match(form, /<button className=\{styles\.primaryAction\} disabled=\{!value\.trim\(\)\} type="submit">/, 'Save is a submit button of the same form');
    assert.match(form, /const url = normalizeEnteredUrl\(value\);[\s\S]*openReview\(url\);/);
    // The one client navigation on Home is a Juple Collection share link going to its Collection flow - never the review.
    assert.deepEqual(home.match(/router\.(push|replace)\([^)]*\)/g), ['router.push(destination.href)']);
    assert.match(home, /const destination = collectionShareDestination\(shareLink\);\s*if \(destination\.kind === 'inApp'\) \{\s*router\.push\(destination\.href\);/);
  });

  it('no soft navigation to the review exists anywhere in the app; the intercepting route loads a non-item address for real', () => {
    for (const file of ['HomeView.tsx', 'archive/ArchiveView.tsx', 'collections/CollectionsView.tsx', 'AppShell.tsx', 'notifications/NotificationsView.tsx', 'items/[itemId]/ItemDetailContent.tsx']) {
      assert.doesNotMatch(source(`app/(app)/${file}`), /reviewHref|router\.(push|replace)\([^)]*items\/new|href="\/items\/new/, file);
    }
    assert.match(source('lib/newLink.ts'), /window\.location\.assign\(href\)/);
    assert.match(source('app/(app)/@modal/(.)items/[itemId]/NotAnItem.tsx'), /window\.location\.reload\(\)/);
    assert.ok(existsSync(new URL('../app/(app)/items/new/page.tsx', import.meta.url)));
  });

  it('what still opens the sheet: only a numeric item id; the editor and the direct address stay full pages', () => {
    const intercepted = source('app/(app)/@modal/(.)items/[itemId]/page.tsx');
    assert.match(intercepted, /return <QuickDetailSheet /);
    assert.match(source('app/(app)/items/[itemId]/page.tsx'), /<ItemDetailsView/);
    assert.ok(existsSync(new URL('../app/(app)/items/[itemId]/edit/page.tsx', import.meta.url)));
    assert.doesNotMatch(source('app/(app)/@modal/(.)items/[itemId]/page.tsx'), /edit/);
  });
});

describe('Quick Detail sheet: another member\'s link in a Collection (no context opens a full page any more)', () => {
  const intercept = source('app/(app)/@modal/(.)collections/[collectionId]/items/[itemId]/page.tsx');
  const content = source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemContent.tsx');

  it('its in-app address /collections/{id}/items/{itemId} is intercepted into the same sheet frame; typed / reloaded stays standalone', () => {
    assert.match(intercept, /<QuickSheetFrame key=\{`\$\{collectionId\}\/\$\{itemId\}`\}>\s*<SharedItemQuickContent collectionIdParam=\{collectionId\} itemIdParam=\{itemId\} \/>/);
    assert.match(intercept, /parseRouteId\(collectionId\) === null \|\| parseRouteId\(itemId\) === null\) \{\s*return <NotAnItem \/>;/);
    // the standalone route is untouched
    assert.match(source('app/(app)/collections/[collectionId]/items/[itemId]/page.tsx'), /<SharedItemView collectionIdParam=\{collectionId\} itemIdParam=\{itemId\}/);
    // a Collection card still routes another member's link to its Collection-scoped address (never /items/{id}: not theirs)
    assert.match(source('lib/savedLinks.ts'), /href: mine \? itemHref\(entry\.itemId\) : sharedItemHref\(collectionId, entry\.itemId\)/);
    // one sheet for both: my link (QuickDetailSheet) and another member's share the frame (dialog, bar, 닫기 = back)
    const sheet = source('app/(app)/items/[itemId]/QuickDetailSheet.tsx');
    assert.match(sheet, /<QuickSheetFrame>\s*<ItemDetailContent /);
    assert.match(sheet, /export function QuickSheetFrame\(\{ children \}/);
  });

  it('read IN the Collection (its gate first, the visit grant), read-only: 링크 열기 is the only action, then who added it and when', () => {
    assert.match(content, /api<SharedCollectionItem>\(\{ path: sharedItemPath\(collectionId, itemId\), headers: unlockHeaders\(collectionId\) \}\)/);
    const actions = content.slice(content.indexOf('className={styles.quickActions}'), content.indexOf('</div>', content.indexOf('className={styles.quickActions}')));
    assert.match(actions, /aria-label=\{dictionary\.openLink\}[^>]*title=\{dictionary\.openLink\}/);
    assert.doesNotMatch(content, /itemEditHref|dictionary\.edit\b|dictionary\.delete\b|removeFromCollection|method: 'DELETE'/);
    assert.match(content, /dictionary\.addedBy[\s\S]*dictionary\.savedAt[\s\S]*dictionary\.sharedItemReadOnly/);
    // the standalone page reads it the same way (one hook)
    assert.match(source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemView.tsx'), /useSharedItem\(collectionIdParam, itemIdParam\)/);
  });

  it('/items/new is still opened by a full navigation (never a sheet)', () => {
    assert.match(source('app/(app)/HomeView.tsx'), /openReview\(url\)/);
  });
});
