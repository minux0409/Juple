import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { RENEWAL_STRINGS } from '../lib/appDictionaryRenewal.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { cardClickIntent, emptySelection, formatLinkList, pruneSelection, runBatch, selectAll, selectRange, toggleSelection, withoutIds } from '../lib/multiSelect.ts';
import { collectionLinkActions, collectionLinkScope, isSelectableLink, lockableCollections, moveTargets, partitionByAuthor, planCollectionBulk, removableLinks, reportEach } from '../lib/selectionRules.ts';
import type { CollectionSummary } from '../lib/collectionsView.ts';
import type { LinkView } from '../lib/savedLinks.ts';

const root = join(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');
const app = (path: string) => source(join('app', '(app)', path));

describe('multi-selection rules (lib/multiSelect)', () => {
  it('toggles, remembers the anchor, and a Shift+click selects the range in display order without losing what was chosen', () => {
    let state = toggleSelection(emptySelection<number>(), 3);
    assert.deepEqual([...state.selected], [3]);
    assert.equal(state.anchor, 3);
    state = selectRange(state, [1, 2, 3, 4, 5, 6], 6);
    assert.deepEqual([...state.selected].sort(), [3, 4, 5, 6]);
    assert.equal(state.anchor, 3, 'the anchor stays for the next Shift+click');
    state = selectRange(state, [1, 2, 3, 4, 5, 6], 1);
    assert.deepEqual([...state.selected].sort(), [1, 2, 3, 4, 5, 6]);
    state = toggleSelection(state, 4);
    assert.equal(state.selected.has(4), false);
  });

  it('a Shift+click without an anchor in this list is a plain toggle', () => {
    const state = selectRange({ selected: new Set([9]), anchor: 9 }, [1, 2, 3], 2);
    assert.deepEqual([...state.selected].sort(), [2, 9]);
  });

  it('select-all adds, prune drops ids that are gone (same object when nothing changes), handled ids leave', () => {
    const all = selectAll(toggleSelection(emptySelection<number>(), 1), [1, 2, 3]);
    assert.deepEqual([...all.selected], [1, 2, 3]);
    assert.equal(pruneSelection(all, () => true), all);
    assert.deepEqual([...pruneSelection(all, id => id !== 2).selected], [1, 3]);
    assert.deepEqual([...withoutIds(all, [1, 3]).selected], [2]);
  });

  it('a plain click opens the card until a selection runs; while one runs a click toggles and Shift+click extends', () => {
    const keys = { shiftKey: false, ctrlKey: false, metaKey: false };
    assert.equal(cardClickIntent(false, keys), 'open');
    assert.equal(cardClickIntent(false, { ...keys, ctrlKey: true }), 'open', 'Ctrl/Cmd+click keeps "open in a new tab" outside a selection');
    assert.equal(cardClickIntent(true, keys), 'toggle');
    assert.equal(cardClickIntent(true, { ...keys, metaKey: true }), 'toggle');
    assert.equal(cardClickIntent(true, { ...keys, shiftKey: true }), 'range');
  });

  it('runBatch runs every id, keeps order, reports the failures and the first error, never more than N at a time', async () => {
    let running = 0;
    let peak = 0;
    const outcome = await runBatch([1, 2, 3, 4, 5, 6, 7], async id => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, id % 3));
      running -= 1;
      if (id % 2 === 0) throw new Error(`no ${id}`);
    }, 3);
    assert.deepEqual(outcome.succeeded, [1, 3, 5, 7]);
    assert.deepEqual(outcome.failed, [2, 4, 6]);
    assert.match(String(outcome.firstError), /no \d/);
    assert.ok(peak <= 3, `peak ${peak}`);
  });

  it('several links copy as one text, one address per line, nothing empty', () => {
    assert.equal(formatLinkList(['https://a.example', null, '', 'https://b.example']), 'https://a.example\nhttps://b.example');
  });
});

describe('selection permissions (lib/selectionRules)', () => {
  const collection = (id: number, extra: Partial<CollectionSummary> = {}) => ({ id, name: `c${id}`, icon: 'Folder', color: null, itemCount: 0, isFavorite: false, ...extra }) as CollectionSummary;

  it('delete = my own open Collections; locked ones are skipped and counted; leave = shared with me; never mixed', () => {
    const plan = planCollectionBulk([
      collection(1),
      collection(2, { isLocked: true }),
      collection(3, { hasCollaborators: true }),
      collection(4, { accessRole: 'contributor' }),
      collection(5, { accessRole: 'viewer', isFavorite: true }),
    ]);
    assert.deepEqual(plan.deletable.map(c => c.id), [1, 3]);
    assert.equal(plan.lockedSkipped, 1);
    assert.equal(plan.sharedAmongDeletable, 1);
    assert.deepEqual(plan.leavable.map(c => c.id), [4, 5]);
    assert.equal(plan.favoriteTarget, true);
    assert.equal(planCollectionBulk([collection(5, { isFavorite: true })]).favoriteTarget, false, 'all favorites -> remove from all');
  });

  const me = { kind: 'person', name: 'me', profileImageUrl: null, isCollectionOwner: false, isMe: true } as const;
  const other = { kind: 'person', name: 'x', profileImageUrl: null, isCollectionOwner: true, isMe: false } as const;
  const link = (id: number, adder: LinkView['adder']) => ({ id, locked: false, adder }) as LinkView;
  const mixed = [link(1, me), link(2, other), link(3, { kind: 'publicLink' })];

  it('the scope: an Owner without collaboration = personal; with members or a public link = owned shared; anyone else = foreign', () => {
    assert.equal(collectionLinkScope('owner', false), 'personalCollection');
    assert.equal(collectionLinkScope('owner', true), 'ownedSharedCollection');
    for (const role of ['contributor', 'viewer', 'submitter'] as const) {
      assert.equal(collectionLinkScope(role, true), 'foreignSharedCollection');
    }
  });

  it('remove from a Collection (mobile deleteTargets): the Owner any link; any member only the links they added', () => {
    assert.deepEqual(removableLinks(mixed, 'ownedSharedCollection').map(l => l.id), [1, 2, 3]);
    assert.deepEqual(removableLinks(mixed, 'foreignSharedCollection').map(l => l.id), [1]);
    assert.deepEqual(removableLinks([link(9, undefined)], 'personalCollection').map(l => l.id), [9], 'a personal Collection: every link is mine');
    assert.deepEqual(removableLinks([link(9, undefined)], 'foreignSharedCollection'), [], 'an unknown adder is never assumed to be mine');
  });

  it('move (mobile moveTargets): only my own links, in every scope', () => {
    assert.deepEqual(moveTargets(mixed, 'ownedSharedCollection').map(l => l.id), [1]);
    assert.deepEqual(moveTargets(mixed, 'foreignSharedCollection').map(l => l.id), [1]);
    assert.deepEqual(partitionByAuthor(mixed, 'ownedSharedCollection').others.map(l => l.id), [2, 3]);
  });

  it('the action list follows the mobile linkSelectionPolicy table', () => {
    assert.deepEqual(collectionLinkActions('personalCollection', [link(1, undefined)]), ['delete', 'move', 'copy']);
    assert.deepEqual(collectionLinkActions('ownedSharedCollection', [link(1, me)]), ['delete', 'move', 'copy']);
    assert.deepEqual(collectionLinkActions('ownedSharedCollection', mixed), ['delete', 'move', 'copy', 'report']);
    assert.deepEqual(collectionLinkActions('ownedSharedCollection', [link(2, other)]), ['delete', 'copy', 'report']);
    assert.deepEqual(collectionLinkActions('foreignSharedCollection', [link(1, me)]), ['delete', 'move', 'copy']);
    assert.deepEqual(collectionLinkActions('foreignSharedCollection', mixed), ['copy', 'report'], 'a mixed selection of a member: no delete, no move');
    assert.deepEqual(collectionLinkActions('foreignSharedCollection', [link(2, other)]), ['copy', 'report']);
  });

  it('bulk lock: only Collections not locked yet (removing a lock needs the password, never in bulk)', () => {
    const list = [{ id: 1, isLocked: true }, { id: 2 }, { id: 3, accessRole: 'viewer' }] as unknown as CollectionSummary[];
    assert.deepEqual(lockableCollections(list).map(c => c.id), [2, 3]);
  });

  it('bulk report: one report each, in order; the rate limit stops the rest and keeps them for later', async () => {
    const sent: number[] = [];
    const outcome = await reportEach(
      [1, 2, 3, 4, 5],
      async id => {
        sent.push(id);
        if (id === 2) return { alreadyReported: true };
        if (id === 4) throw Object.assign(new Error('429'), { status: 429 });
        return { alreadyReported: false };
      },
      error => (error as { status?: number }).status === 429,
    );
    assert.deepEqual(sent, [1, 2, 3, 4], 'nothing is sent after the limit');
    assert.deepEqual(outcome.received, [1, 3]);
    assert.deepEqual(outcome.alreadyReported, [2]);
    assert.deepEqual(outcome.failed, [4, 5]);
    assert.equal(outcome.rateLimited, true);
  });

  it('a redacted (locked) card can never be chosen', () => {
    assert.equal(isSelectableLink({ locked: true }), false);
    assert.equal(isSelectableLink({ locked: false }), true);
  });
});

describe('the pages use the selection', () => {
  it('Home, 보관함 and a Collection wrap their lists; 최근 조회한 링크 stays outside (never selectable)', () => {
    assert.match(app('HomeView.tsx'), /<PersonalLinkSelection selectAllIds=/);
    assert.ok(app('HomeView.tsx').indexOf('<HomeRecentLinks') > app('HomeView.tsx').indexOf('</PersonalLinkSelection>'));
    assert.match(app('archive/ArchiveView.tsx'), /<PersonalLinkSelection>/);
    assert.match(app('collections/[collectionId]/CollectionDetailsView.tsx'), /<CollectionLinkSelection collectionId=\{collection\.id\} role=\{collection\.accessRole \?\? 'owner'\} source=\{collection\}>/);
    assert.match(app('collections/CollectionsView.tsx'), /useCollectionSelection\(/);
  });

  it('a card keeps opening on a plain click: the selection only takes it while one runs (preventDefault in that case only)', () => {
    const list = app('SavedLinkList.tsx');
    assert.match(list, /onClick=\{onMainClick\}/);
    assert.match(list, /aria-pressed=\{selected\}/);
    const selection = app('LinkSelection.tsx');
    assert.match(selection, /if \(intent === 'open'\) \{\s*return false;\s*\}\s*event\.preventDefault\(\);/);
  });

  it('deleting links asks first, names the count, and offers one undo through the server restore', () => {
    const selection = app('LinkSelection.tsx');
    assert.match(selection, /open=\{dialog === 'delete'\}/);
    assert.match(selection, /selectionDeleteLinksTitle/);
    assert.match(selection, /method: 'POST', path: itemRestorePath\(id\)/);
    assert.match(selection, /notifyItemsChanged\(\{ kind: 'deleted', itemId: id \}\)/);
  });

  it('Escape ends a selection only when no dialog owns it', () => {
    assert.match(app('LinkSelection.tsx'), /event\.key === 'Escape' && !event\.defaultPrevented && !dialogIsOpen\(\)/);
    assert.match(app('collections/useCollectionSelection.tsx'), /document\.querySelector\('dialog\[open\]'\) === null/);
  });
});

describe('requests', () => {
  it('Collection Details: 받은 승인 요청 and 참여 요청 are two independent buttons, each with its own count and its own queue', () => {
    const details = app('collections/[collectionId]/CollectionDetailsView.tsx');
    assert.match(details, /label=\{dictionary\.requestsPendingSubmissions\}/);
    assert.match(details, /label=\{dictionary\.requestsJoinRequests\}/);
    assert.match(details, /setRequestsQueue\('link'\)/);
    assert.match(details, /setRequestsQueue\('person'\)/);
    assert.match(app('collections/ReceivedRequestsDialog.tsx'), /useState<'link' \| 'person' \| null>\(initialQueue \?\? null\)/);
    const button = app('collections/RequestActionButton.tsx');
    assert.match(button, /styles\.requestActionBadge/);
    assert.match(button, /name="Chevron"/);
    const css = app('app.module.css');
    assert.match(css, /\.requestActions \{\s*display: flex;\s*flex-wrap: wrap;/, 'side by side, wrapping (stacked) when there is no room');
    assert.match(css, /\.requestActionLabel \{[^}]*-webkit-line-clamp: 2;/, 'at most two lines of text');
    assert.match(css, /\.requestActionBadge \{[^}]*flex: 0 0 auto;/, 'the badge never shrinks');
  });

  it('a waiting Collection tile opens the cancel question directly; closing never withdraws', () => {
    assert.match(app('collections/CollectionsView.tsx'), /<PendingJoinDialog cancelFirst/);
    const dialog = app('collections/PendingJoinDialog.tsx');
    assert.match(dialog, /useState\(cancelFirst\)/);
    assert.match(dialog, /if \(cancelFirst\) onClose\(\);/);
    assert.match(dialog, /onClick=\{\(\) => \{ if \(confirm\) void withdraw\(\); else onClose\(\); \}\}/);
  });

  it('a backdrop click only closes (Modal: onClose; ConfirmDialog: cancel, not while busy); dialogs with typed input keep it', () => {
    assert.match(app('Modal.tsx'), /useBackdropDismiss\(onClose, !keepOnBackdrop\)/);
    assert.match(app('ConfirmDialog.tsx'), /useBackdropDismiss\(onCancel, !busy\)/);
    assert.match(app('collections/[collectionId]/CollectionManagementDialogs.tsx'), /<Modal keepOnBackdrop/);
    const hook = app('useBackdropDismiss.ts');
    assert.match(hook, /startedOutside\.current && event\.target === event\.currentTarget/);
  });
});

describe('merging stays gone', () => {
  it('no merge route, component, string or API call in the Web app', () => {
    const files = ['collections/[collectionId]/CollectionDetailsView.tsx', 'collections/CollectionsView.tsx', 'LinkSelection.tsx', 'collections/useCollectionSelection.tsx', 'DestinationDialog.tsx', 'CollectionPicker.tsx'];
    for (const file of files) {
      assert.doesNotMatch(app(file), /merge|Merge|병합/, file);
    }
    assert.doesNotMatch(source('lib/collectionOperations.ts'), /\/merge|mergePath|MergeCollection/);
  });
});

describe('membership on the Web', () => {
  it('shows the server-reported status and the two plans, with no price and nothing to buy', () => {
    const section = app('me/MyPageSections.tsx');
    assert.match(section, /data-membership-status/);
    assert.match(section, /data-plan="monthly"/);
    assert.match(section, /data-plan="yearly"/);
    // Only the membership section itself (the same file also holds the data export, which has its own POST).
    const start = section.indexOf('export function SubscriptionSection');
    const code = section.slice(start, section.indexOf('\nexport function', start + 1)).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /checkout|requestPurchase|requestSubscription|billing\/(google|apple)|method: 'POST'|\$\d|USD|KRW/);
  });

  it('a store subscription the server does not name gets both stores\' own cancel steps (never a guess)', () => {
    assert.match(app('me/MyPageSections.tsx'), /subscribedUnknownStore = subscribedNow && storeSubscription\?\.platform !== 'google' && storeSubscription\?\.platform !== 'apple'/);
  });
});

describe('shell and motion', () => {
  const css = app('app.module.css');

  it('the side bar collapses on wide screens (remembered per browser) and one marker slides to the active destination', () => {
    const shell = app('AppShell.tsx');
    assert.match(shell, /data-sidebar=\{sidebar\}/);
    assert.match(shell, /SIDEBAR_STORAGE_KEY = 'juple\.web\.sidebar'/);
    assert.match(shell, /aria-expanded=\{!collapsed\}/);
    assert.match(css, /\.shell\[data-sidebar='collapsed'\] \{\s*grid-template-columns: var\(--sidebar-collapsed-width\)/);
    assert.match(css, /\.navIndicator \{[^}]*transition: transform var\(--motion-layout\)/);
  });

  it('narrow screens keep the top bar: no stretched bottom tab bar and no jelly / liquid effect', () => {
    assert.doesNotMatch(css, /jelly|liquid|blob/i);
    assert.doesNotMatch(app('AppShell.tsx'), /bottomTab|tabBar/i);
  });

  it('motion is transform / opacity within 120-420ms and switched off for prefers-reduced-motion; no infinite animation is added', () => {
    const renewal = css.slice(css.indexOf('Web renewal - multi-selection'));
    assert.match(renewal, /--motion-fast: 140ms;\s*--motion-base: 220ms;\s*--motion-layout: 280ms;/);
    assert.doesNotMatch(renewal, /infinite/);
    assert.match(renewal, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.page,[\s\S]*animation: none;/);
    assert.doesNotMatch(renewal, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'Light and Dark follow the tokens');
  });

  it('the star is the mobile FavoriteStar: gradient fill on, outline off, a play only after the person\'s own tap (never on load, a rollback or a bulk action)', () => {
    const star = app('FavoriteStar.tsx');
    // the mobile polygon, gradient stops and particle count
    assert.match(star, /'12 3 14\.6 8\.9 21 9\.6 16\.2 13\.9 17\.5 20\.2 12 17 6\.5 20\.2 7\.8 13\.9 3 9\.6 9\.4 8\.9'/);
    assert.match(star, /const PARTICLES = 8;/);
    assert.match(star, /const PENDING_TTL_MS = 1500;/);
    assert.match(star, /if \(!userTap\) \{/);
    for (const view of ['collections/CollectionsView.tsx', 'collections/[collectionId]/CollectionDetailsView.tsx']) {
      const text = app(view);
      assert.match(text, /<FavoriteStar active=\{collection\.isFavorite === true\} playToken=\{starTap\} size=\{20\} \/>/);
      assert.match(text, /bumpStar\(\);\s*onToggleFavorite\(\);/, 'the tap arms the play, then the optimistic toggle runs');
    }
    const mobile = readFileSync(join(root, '..', 'mobile', 'src', 'components', 'FavoriteStar.tsx'), 'utf8');
    assert.match(mobile, /const ON_BURST_MS = 270;/);
    assert.match(mobile, /const OFF_FILL_MS = 190;/);
    assert.match(css, /\.favStar\[data-play='on'\] \.favStarSvg \{\s*animation: favStarOn 270ms/);
    assert.match(css, /\.favStar\[data-play='off'\] \.favStarSvg \{\s*animation: favStarOff 190ms/);
    assert.match(css, /--star-off: #9a9a9a;/);
    assert.match(css, /--star-off: #6b7482;/);
    assert.match(mobile, /border: '#9A9A9A'|inactiveColor = colors\.border/);
    // the star never moves its card: the particles overlay is zero-size and absolute, the star keeps its own box
    assert.match(css, /\.favStarBurst \{[^}]*position: absolute;[^}]*width: 0;[^}]*height: 0;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.favStar\[data-play\] \.favStarSvg,[\s\S]*animation: none;/);
  });

  it('while a selection runs the cards\' quick actions (the favorite star) are not tappable: choosing never toggles a favorite, and the star keeps its own state', () => {
    assert.match(css, /\[data-selecting='true'\] \.collectionActions \{\s*pointer-events: none;/);
    assert.match(app('collections/CollectionsView.tsx'), /data-selecting=\{selection\.active \? 'true' : undefined\}/);
  });
});

describe('strings', () => {
  it('every new Web-only string is written in all 17 languages (none falls back to English)', () => {
    const keys = Object.keys(RENEWAL_STRINGS.en) as (keyof (typeof RENEWAL_STRINGS)['en'])[];
    for (const language of APP_LANGUAGES) {
      for (const key of keys) {
        assert.ok(RENEWAL_STRINGS[language][key].trim(), `${language} ${key}`);
        if (language !== 'en' && language !== 'ko') {
          assert.notEqual(RENEWAL_STRINGS[language][key], RENEWAL_STRINGS.en[key], `${language} ${key} is translated`);
        }
      }
    }
  });

  it('the selection and membership words come from the mobile locale files in every language', () => {
    for (const language of APP_LANGUAGES) {
      const dictionary = getAppDictionary(language);
      for (const key of ['selectionSelectedCount', 'selectionDeleteLinksTitle', 'selectionAddToCollections', 'selectionCopyToCollection', 'membershipTitle', 'membershipPlanMonthlyName', 'membershipPlanYearlyName', 'sidebarCollapse'] as const) {
        assert.ok(dictionary[key]?.trim(), `${language} ${key}`);
      }
      assert.match(dictionary.selectionSelectedCount, /\{count\}/, `${language}: the count placeholder survives`);
    }
  });
});

describe('second pass: move, report, lock, docked controls, store guidance', () => {
  it('a mixed move says what will and will not move BEFORE anything happens; only an all-atomic move offers an undo', () => {
    const selection = app('LinkSelection.tsx');
    assert.match(selection, /setDialog\(others\.length > 0 \? 'moveMixed' : 'move'\)/);
    assert.match(selection, /if \(undos\.size === outcome\.succeeded\.length\) \{\s*toast\.showUndo/);
    assert.match(selection, /method: 'PUT', path: membershipPath\(target\.collection\.id, itemId\)[\s\S]*?method: 'DELETE', path: membershipPath\(collectionId, itemId\)/, 'add first, then remove');
  });

  it('bulk report goes through the one report dialog (a reason is required) and keeps the unsent links selected', () => {
    assert.match(app('LinkSelection.tsx'), /safety\.reportMany\(targets,/);
    const safety = app('SafetyProvider.tsx');
    assert.match(safety, /reportMany: \(targets, onDone\) => setReporting\(\{ targets, onDone \}\)/);
    assert.match(safety, /error => error instanceof ApiHttpError && error\.status === 429/);
  });

  it('bulk lock uses the Owner lock or the member lock per Collection, after a confirmation', () => {
    const selection = app('collections/useCollectionSelection.tsx');
    assert.match(selection, /isSharedWithMe\(collection\) \? collectionSetMemberLockPath\(id\) : collectionSetLockPath\(id\)/);
    assert.match(selection, /open=\{dialog === 'lock'\}/);
    assert.match(selection, /collectionLockPasswordNotConfigured/);
  });

  it('Home, 보관함, 컬렉션 and a Collection dock their controls; the shell publishes the narrow top bar height', () => {
    assert.match(app('HomeView.tsx'), /<StickyControls>\s*<AddLinkForm \/>/);
    assert.match(app('archive/ArchiveView.tsx'), /<StickyControls>\s*<div className=\{styles\.searchBlock\}>/);
    assert.match(app('collections/CollectionsView.tsx'), /<StickyControls>\s*<div className=\{sectionStyles\.sections\} data-collection-toolbar>/);
    assert.match(app('collections/[collectionId]/CollectionDetailsView.tsx'), /<StickyControls>\s*<div className=\{styles\.toolbar\}>/);
    assert.match(app('AppShell.tsx'), /setProperty\('--shell-top-offset'/);
    assert.match(app('app.module.css'), /\.stickyControls \{\s*position: sticky;\s*top: var\(--shell-top-offset, 0px\);/);
  });

  it('membership: Google Play or App Store guidance by the server-named store; an unnamed store gets both and no link', () => {
    const section = app('me/MyPageSections.tsx');
    assert.match(section, /subscribedOnAppStore = storeSubscription\?\.platform === 'apple' && subscribedNow/);
    assert.match(section, /href=\{APP_STORE_SUBSCRIPTIONS_URL\}/);
    assert.match(section, /data-store-guide="unknown"/);
    assert.match(source('lib/subscription.ts'), /value\.platform === 'google' \|\| value\.platform === 'apple' \? value\.platform : null/);
  });
});

describe('mobile parity: the 시간순 / 이름순 sort controls stay removed', () => {
  it('no sort chips component or sort-chip dictionary use in Home, 보관함, 컬렉션 상세', () => {
    for (const file of ['HomeFavorites.tsx', 'archive/ArchiveView.tsx', 'collections/[collectionId]/CollectionDetailsView.tsx']) {
      assert.doesNotMatch(app(file), /SortChips|dictionary\.sortTime|dictionary\.sortName|sortGroupLabel/, file);
    }
    assert.throws(() => app('SortChips.tsx'));
  });
});
