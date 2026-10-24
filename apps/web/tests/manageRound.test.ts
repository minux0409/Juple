import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError, type AppApi, type AppApiRequest } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  copyItemsPath,
  copyResultMessage,
  grantHeaders,
  isCollaborationActive,
  loadOwnedCollections,
  membershipPath,
  moveStrategy,
  replicatePath,
  replicateResultMessage,
  transferPath,
} from '../lib/collectionOperations.ts';
import { nextActiveIndex } from '../lib/listNavigation.ts';
import { activeSettingsItem } from '../lib/settingsNav.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = source('app/(app)/app.module.css');
const rule = (selector: string) => {
  let start = css.indexOf(`\n${selector} {`);
  while (start > 0 && css.slice(0, start).trimEnd().endsWith(',')) {
    start = css.indexOf(`\n${selector} {`, start + 1);
  }
  assert.ok(start >= 0, selector);
  return css.slice(start, css.indexOf('\n}', start));
};
const ko = getAppDictionary('ko');
const popover = source('app/(app)/Popover.tsx');
const sharing = source('app/(app)/collections/[collectionId]/CollectionSharing.tsx');

/** A fake API: answers by "METHOD path" and records every request. */
function fakeApi(answers: Record<string, (request: AppApiRequest) => unknown>) {
  const calls: AppApiRequest[] = [];
  const api = (async (request: AppApiRequest) => {
    calls.push(request);
    const route = `${request.method ?? 'GET'} ${request.path.split('?')[0]}`;
    const answer = answers[route];
    if (!answer) {
      throw new Error(`unexpected ${route}`);
    }
    return answer(request);
  }) as AppApi;
  return { api, calls };
}

describe('1. the role pill opens its own listbox (no native select)', () => {
  it('arrows move and wrap, Home / End jump, disabled rows are skipped', () => {
    const none = [false, false, false];
    assert.equal(nextActiveIndex(0, 'ArrowDown', none), 1);
    assert.equal(nextActiveIndex(2, 'ArrowDown', none), 0);
    assert.equal(nextActiveIndex(0, 'ArrowUp', none), 2);
    assert.equal(nextActiveIndex(1, 'End', none), 2);
    assert.equal(nextActiveIndex(2, 'Home', none), 0);
    assert.equal(nextActiveIndex(0, 'ArrowDown', [false, true, false]), 2);
    assert.equal(nextActiveIndex(-1, 'Home', [true, false, false]), 1);
    assert.equal(nextActiveIndex(1, 'x', none), 1);
    assert.equal(nextActiveIndex(0, 'ArrowDown', []), -1);
  });

  it('a real button + listbox: haspopup / expanded / controls, options with aria-selected, the active one announced', () => {
    assert.match(popover, /aria-controls=\{open \? listId : undefined\}\s*aria-expanded=\{open\}\s*aria-haspopup="listbox"/);
    assert.match(popover, /role="listbox"/);
    assert.match(popover, /aria-selected=\{option\.value === value\}/);
    assert.match(popover, /role="option"/);
    assert.match(popover, /aria-activedescendant=\{active >= 0 \? `\$\{listId\}-\$\{active\}` : undefined\}/);
  });

  it('Enter / Space choose, Escape closes only the panel (not the dialog it is in) and focus returns to the pill', () => {
    assert.match(popover, /if \(event\.key === 'Enter' \|\| event\.key === ' '\) \{\s*event\.preventDefault\(\);\s*choose\(active\);/);
    assert.match(popover, /event\.preventDefault\(\);\s*\/\/ The panel only - never the dialog it sits in\.\s*event\.stopPropagation\(\);/);
    assert.match(popover, /const shut = \(returnFocus: boolean\) => \{\s*setOpen\(false\);\s*if \(returnFocus\) \{\s*triggerRef\.current\?\.focus\(\);/);
  });

  it('a click outside closes it; the panel is placed from the pill (never clipped by a scrolling list) and takes focus once placed', () => {
    assert.match(popover, /document\.addEventListener\('pointerdown', outside, true\);/);
    assert.match(popover, /if \(open && placement\) \{\s*panelRef\.current\?\.focus\(\);/);
    assert.match(rule('.floatingPanel'), /position: fixed;/);
  });

  it('busy keeps the pill focusable (aria-disabled, not disabled), so focus stays while the change is saved', () => {
    assert.match(popover, /aria-disabled=\{disabled \|\| undefined\}/);
    assert.doesNotMatch(popover, /disabled=\{disabled\}/);
  });

  it('members and invitations use the ONE shared selector; there is no native select left in the share screen', () => {
    assert.doesNotMatch(sharing, /<select\b/);
    assert.match(sharing, /<PillListbox\s/);
    assert.equal((sharing.match(/<RoleSelect\s/g) ?? []).length, 2);
  });

  it('the same pill look closed and open: pill radius, height, typography; the panel in the same language (thin border, brand-soft chosen row)', () => {
    const pill = rule('.pillButton');
    assert.match(pill, /height: 32px;/);
    assert.match(pill, /border-radius: 999px;/);
    assert.match(pill, /font-size: 12\.5px;/);
    assert.match(rule('.floatingPanel'), /border: 1px solid var\(--app-border\);/);
    assert.match(css, /\.floatingRow\[aria-selected='true'\] \{\s*background: var\(--brand-soft\);/);
  });

  it('the role API and its restore-on-refusal are unchanged', () => {
    assert.match(sharing, /setRoleChange\(\{ key, role, source: participants \}\);/);
    assert.match(sharing, /caught => \{\s*setRoleChange\(null\);\s*return actionWords\(caught\);/);
  });
});

describe('2-3. one surface, one typography', () => {
  it('an invitation card is the participant card (no dashed / tinted variant); 수락 대기 says it', () => {
    assert.match(sharing, /<li className=\{styles\.personCard\} data-person-row="pending"/);
    assert.doesNotMatch(css, /personCardPending/);
  });

  it('컬렉션 잠금: 잠금 비밀번호 변경 is the same row and label as 상태 (chevron, pointer and hover mark the action)', () => {
    const lock = source('app/(app)/me/collection-lock/page.tsx');
    assert.match(lock, /<button className=\{`\$\{styles\.settingsRow\} \$\{styles\.settingsRowAction\}`\} onClick=\{\(\) => setForm\('change'\)\} type="button">\s*<span className=\{styles\.settingsLabel\}>\{dictionary\.collectionLockChangePassword\}<\/span>/);
    assert.match(rule('.settingsRowAction'), /text-decoration: none;/);
  });
});

describe('4. 구독 on the Web never sells', () => {
  const page = source('app/(app)/me/MyPageSections.tsx');
  it('the status and its dates; Google Play\'s own page for a Play subscriber; the app-only sentence for everyone', () => {
    assert.match(page, /data-subscription-app-only/);
    assert.equal(ko.subscriptionWebAppOnly, '구독 시작 및 결제 관리는 Juple 앱에서 이용해 주세요. 웹에서는 구독 결제를 지원하지 않습니다.');
    assert.match(page, /href=\{PLAY_SUBSCRIPTIONS_URL\}/);
  });
  it('no purchase, checkout, price or plan anywhere in the Web app', () => {
    // Code only - the comments say exactly that ("never a checkout of ours").
    const app = (source('app/(app)/me/subscription/page.tsx') + page + source('lib/subscription.ts')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(app, /checkout|purchase|requestSubscription|price|billing\/google|\/verify/i);
  });
});

describe('5. controls are not text', () => {
  it('menus, tabs, chips and buttons do not select; content (titles, comments, memos) and fields stay selectable', () => {
    const selector = css.slice(css.indexOf('.shell :where(button, [role=\'tab\']'), css.indexOf('user-select: none;', css.indexOf('.shell :where(button, [role=\'tab\']')));
    for (const part of ['button', "[role='tab']", "[role='menuitem']", "[role='option']", 'nav a', '.settingsRowAction', '.navLink']) {
      assert.ok(selector.includes(part), part);
    }
    for (const content of ['.linkTitle', '.quickTitle', '.commentBody', '.quickMemo', 'input', 'textarea']) {
      assert.ok(!selector.includes(content), content);
    }
  });
});

describe('6. modal header never painted over', () => {
  it('a fixed header row over a body that scrolls on its own', () => {
    assert.match(source('app/(app)/Modal.tsx'), /<div className=\{styles\.panelScroll\} data-modal-body>/);
    assert.match(css, /\.panelDialog\[open\] \{\s*display: flex;\s*flex-direction: column;\s*overflow: hidden;/);
    assert.match(rule('.panelScroll'), /min-height: 0;\s*overflow-y: auto;/);
    assert.match(css, /\.panelDialog \.panelHeader \{\s*position: relative;\s*z-index: 1;\s*flex: 0 0 auto;/);
  });
});

describe('7. 고객센터', () => {
  const center = source('app/(app)/me/support/CustomerCenter.tsx');
  it('a settings item of its own, with the mobile words', () => {
    assert.equal(activeSettingsItem('/me/support')?.key, 'support');
    assert.equal(ko.customerCenterTitle, '고객센터');
    assert.equal(ko.customerCenterTerms, '이용약관');
    assert.equal(ko.customerCenterPrivacy, '개인정보처리방침');
    assert.equal(ko.customerCenterInquiry, '문의하기');
  });
  it('이용약관 / 개인정보처리방침 open the existing pages; 문의하기 is the in-app inquiry of the mobile app (tests/supportAndUndo.test.ts) - no mailto', () => {
    assert.match(center, /href="\/terms"/);
    assert.match(center, /href="\/privacy"/);
    assert.match(center, /data-support-new href="\/me\/support\/new"/);
    assert.doesNotMatch(center, /mailto:/);
    assert.doesNotMatch(source('app/(app)/me/support/page.tsx'), /readLegalOperatorConfig/);
  });
});

describe('8-12. moving and copying links: the existing Backend API only', () => {
  it('every route exists on the server', () => {
    const controller = repo('backend/src/Juple.Api/Controllers/CollectionsController.cs');
    assert.match(controller, /\[HttpPost\("\{sourceCollectionId:long\}\/items\/\{itemId:long\}\/move"\)\]/);
    assert.match(controller, /\[HttpPut\("\{id:long\}\/items\/\{itemId:long\}"\)\]/);
    assert.match(controller, /\[HttpDelete\("\{id:long\}\/items\/\{itemId:long\}"\)\]/);
    assert.match(repo('backend/src/Juple.Api/Controllers/CollectionItemCopyController.cs'), /\[Route\("api\/v1\/collections\/\{id:long\}\/items\/copy"\)\]/);
    assert.match(repo('backend/src/Juple.Api/Controllers/ItemCollectionsController.cs'), /AddItemToCollectionsResponse\(int AddedCount, int SkippedCount\)/);
    assert.equal(replicatePath(7), '/api/v1/items/7/collections');
    assert.equal(transferPath(11, 7), '/api/v1/collections/11/items/7/move');
    assert.equal(membershipPath(12, 7), '/api/v1/collections/12/items/7');
    assert.equal(copyItemsPath(13), '/api/v1/collections/13/items/copy');
  });

  it('move: atomic only between two Collections of mine nobody else is in; anything shared is add-then-remove', () => {
    assert.equal(moveStrategy({ accessRole: 'owner', hasCollaborators: false }, { accessRole: 'owner', hasCollaborators: false }), 'atomic');
    assert.equal(moveStrategy({ accessRole: 'owner', hasCollaborators: true }, { accessRole: 'owner' }), 'addThenRemove');
    assert.equal(moveStrategy({ accessRole: 'owner' }, { accessRole: 'owner', hasCollaborators: true }), 'addThenRemove');
    assert.equal(moveStrategy({ accessRole: 'contributor' }, { accessRole: 'owner' }), 'addThenRemove');
    assert.equal(isCollaborationActive(new ApiHttpError(409, 'collaborationActive')), true);
    assert.equal(isCollaborationActive(new ApiHttpError(409, 'other')), false);
  });

  it('move adds to the destination BEFORE removing from here, and falls back when the server still sees collaboration (source preserved on failure)', () => {
    const details = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    const add = details.indexOf("method: 'PUT', path: membershipPath(target.collection.id, itemId)");
    const remove = details.indexOf("method: 'DELETE', path: membershipPath(fromCollectionId as number, itemId)");
    assert.ok(add > 0 && remove > add);
    assert.match(details, /if \(!isCollaborationActive\(caught\)\) \{\s*throw caught;/);
  });

  it('copy (복제) of my link adds memberships, never a duplicate Item; Collections it is in are shown and cannot be chosen again', () => {
    const details = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(details, /method: 'POST', path: replicatePath\(itemId\), body: \{ collectionIds: picked\.map\(entry => entry\.collection\.id\), unlockTokens \}/);
    assert.match(details, /contained=\{destination === 'replicate' && collections\.kind === 'loaded' \? collections\.items\.map\(entry => entry\.id\) : \[\]\}/);
    assert.equal(replicateResultMessage({ addedCount: 0, skippedCount: 1 }, ko), ko.replicateResultNone);
    assert.equal(replicateResultMessage({ addedCount: 2, skippedCount: 0 }, ko), '2개 컬렉션에 복제했어요.');
  });

  it('the menus by ownership: my link - 복제 / 이동; another member\'s link - only 링크 저장 (never moved)', () => {
    const details = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(details, /\{removeFromCollection \? \(\s*<ActionMenu/);
    const shared = source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemContent.tsx');
    assert.match(shared, /key: 'saveLink', label: dictionary\.copyToMine, icon: 'Archive', onSelect: \(\) => openReview\(url, href => router\.push\(href\)/);
    assert.doesNotMatch(shared, /moveToOther|transferPath|membershipPath/);
  });

  it('destinations are always my own Collections (mobile picker); a locked one\'s grant travels only with it', async () => {
    const { api, calls } = fakeApi({
      'GET /api/v1/collections': () => ({ items: [{ id: 1, accessRole: 'owner' }, { id: 2, accessRole: 'viewer' }, { id: 3 }], nextCursor: null }),
    });
    const owned = await loadOwnedCollections(api);
    assert.deepEqual(owned.map(entry => entry.id), [1, 3]);
    assert.match(calls[0].path, /scope=owned/);
    assert.deepEqual(grantHeaders('a', null, 'b', 'a'), { 'X-Juple-Collection-Unlock': 'a,b' });
    assert.equal(grantHeaders(null, undefined), undefined);
  });

  it('another member\'s link: 링크 저장 opens the ordinary save screen with the URL / title / picture only - nothing is copied before Save', () => {
    const shared = source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemContent.tsx');
    assert.match(shared, /openReview\(url, href => router\.push\(href\), \{ title: item\.title, image: isSafeHttpUrl\(item\.previewImageUrl\) \? item\.previewImageUrl : null \}\)/);
    assert.doesNotMatch(shared, /copyItemsPath|items\/copy|item\.memo|item\.photos/, 'no copy request; the other member\'s memo and photos never travel');
  });

  it('copy result words are the mobile ones', () => {
    assert.equal(copyResultMessage({ copiedCount: 3, skippedCount: 0, unavailableCount: 0 }, ko), '링크 3개를 복사했어요.');
    assert.equal(copyResultMessage({ copiedCount: 1, skippedCount: 1, unavailableCount: 1 }, ko), '3개 중 1개를 복사했어요. 1개는 이미 컬렉션에 있어요. 1개는 더 이상 이 컬렉션에 없어요.');
  });
});

// 12. 내 컬렉션으로 복제 - see tests/cloneRound.test.ts (the shared editor page).

describe('13. link actions never merge (병합 is the Collection header\'s alone - tests/mergeRound.test.ts)', () => {
  it('the link details and the shared-link views never call merge', () => {
    for (const file of ['app/(app)/items/[itemId]/ItemDetailContent.tsx', 'app/(app)/collections/[collectionId]/items/[itemId]/SharedItemContent.tsx', 'app/(app)/collections/[collectionId]/clone/CloneCollectionView.tsx']) {
      assert.doesNotMatch(source(file), /mergePath|\/merge|mergeWithOther/, file);
    }
  });
});
