# Web / Mobile attention badges

## Scope

Local source change only. No deployment, production setting change, data mutation, new API, migration, or push registration change.
Production endpoints remain `https://juple.co.kr` and `https://api.juple.co.kr`.
Browser fixtures are local isolated mocks, not the Azure DEV environment; their accept/decline operations never reach real users.

## Counting policy

| Source | Collections parent | Collection types | Friends / account | Bell |
| --- | --- | --- | --- | --- |
| Pending received collection invitation | Once per invitation ID | **공유 only**, until accepted | No | Existing unread policy, independent |
| Owner's pending link submission / join request (받은 승인 요청) | Existing `attentionCount` | **공유 only** (one number per owner Collection: submissions + join requests) | No | Never added again |
| Unread new links in a collection | Existing `attentionCount` | None - the card of that Collection only | No | Never added again |
| Pending incoming friend request | No | No | Once per request ID; **Web 친구 only** (Settings never shows it), Mobile My Page mirrors it | Never added again |
| Sent invitation / outgoing friend request / my own waiting proposal or join request | No | No | No | Existing notification history only |
| Comment, reaction, reply, like, informational share or accepted/rejected result | No | No | No | Existing unread policy only |

- Home and Archive currently have no actionable source in these APIs, so their badges are hidden. They do not receive the global unread total.
- `CollectionDto.AttentionCount` already combines the caller's unread new-link events with owner-only submission/join tasks. Clients never recompute it from notification history.
- Collection IDs, invitation IDs and request IDs are deduplicated independently. Type filters overlap, so their numbers are **not** summed into the parent number.
- Requests are shared-Collection work: only the 공유 type carries a number (received invitations + the Owner's own pending approvals); 즐겨찾기 / 전체 / 내 컬렉션 never repeat them, and a card keeps its own number on its own Collection. The parent Collections number (menu / bottom tab) is the unique sum of the cards' `attentionCount` plus received invitations.
- Request rows (same component on both platforms - bell, name, red count badge at the end before the chevron; the number is never part of the label; the sent row is the exception: neutral, with "대기 n건" instead of a badge): **보낸 승인 요청** (my own waiting proposals, `my-pending-submissions/count`; a quiet neutral *status* row - white card, thin border, "대기 n건" text, no badge, never counted anywhere), **받은 승인 요청** (Owner: lists the Collections with waiting links / join requests, then the Collection's own answering UI - the same endpoints Mobile's sheets use) and **받은 초대 요청**. All three show only on 공유 컬렉션, only while something waits.
- Unaccepted invitations are not existing members of All / Owned / Favorites. Accepting moves the collection into its actual memberships.
- The invitation entry card shows only received invitations. Shared and parent badges can be larger when other collection tasks/new links also exist.
- Reading an invitation/friend-request notification does not answer the request. Successful read-all or opening a collection clears only its unread-new-link portion; pending tasks remain until actually answered.
- Zero is hidden; 1–99 show the number; larger values show `99+`. Web accessibility labels retain the full known count.

## Existing API reuse and its boundary

1. `GET /api/v1/users/me/collection-invitations`: all unexpired pending received invitations for non-deleted collections.
2. `GET /api/v1/friends/requests`: incoming and outgoing pending rows; only incoming rows count.
3. `GET /api/v1/collections?scope=all&limit=100&cursor=…`: every metadata page is loaded atomically; a first-page count is never presented as the collection total. Repeated cursors and account changes abort pagination.

**Existing API limitation:** `FriendService.MaxRequestsListed` is 200, covering incoming and outgoing together. The count is exact for the returned pending set, and both clients use the same set. If an account has more than 200 pending requests, the API provides no total or cursor, so an exact incoming total cannot be reconstructed by clients. No notification-total guess or cap removal is used. A future server-side incoming-count field/aggregate is required for exact totals beyond that existing boundary. This round does not claim that case is solved.

## Refresh, requests and account isolation

- Web has no push channel: the shell polls the bell total once a minute while the tab is visible (`UNREAD_POLL_INTERVAL_MS`, doubling per consecutive failure up to 5 minutes); a rise re-reads the badge sources through the same coalescing store, so a new friend request shows within about a minute (immediately on window focus after the 60 s cache). Hidden tabs do not poll. Expected cost: 1 GET/min per open visible tab.
- Separate in-memory store per signed-in account. Web shell/pages and Mobile provider/screens/API helpers share it. Nothing is persisted across logout.
- Startup: invitations + friend requests + all collection metadata pages. For up to 100 collections this is three GETs; each additional metadata page adds one. Existing screen-specific lists remain independent.
- Successful values are cached for 60 seconds. Concurrent readers share the same pending request; screen focus, Web focus/visibility/navigation and Mobile foreground reuse this cache. There is no new idle polling.
- New Mobile Push / Web bell-count changes refresh relevant resources. Rapid events are coalesced with a two-second interval and one trailing refresh so the last event is not lost.
- Explicit invitation/friend actions patch the shared source immediately after success. Pull-to-refresh, stale-row recovery and existing bounded outgoing-friend polling explicitly reload through the same deduplicating store.
- Existing outgoing polling is preserved; outgoing rows still never contribute to attention counts.
- Retry-After on 429 blocks new badge reads across all resources (60 seconds if absent). Ordinary failures defer repeated reads for 15 seconds and retain each last successful resource. No timer-driven failure retry loop is added.
- Logout/account replacement clears visible counts, pending timers and previous responses. Removed foreground/Push listeners cannot restart a previous account's reads. Queued microtasks check session generation before issuing HTTP; collection pagination checks again before each page.
- Focus within the 60-second cache window can show the last known value until a relevant event, explicit refresh or later focus. Web has no new realtime channel; badges do not promise instant cross-device delivery without a signal.
- Large collection inventories require O(number of metadata pages) per refresh. A future small aggregate endpoint can reduce that cost; no unnecessary notification-history scan or new backend endpoint is introduced here.

### Badge request budget

These counts concern the shared badge sources. Existing visible lists, authentication/bootstrap, profile, bell unread count and friend-list refreshes remain separate requests.

| Operation | Badge-source HTTP |
| --- | --- |
| Login / account replacement | 3 GETs for at most 100 collections; +1 for each additional collection page |
| Concurrent shell / type tabs / invitation card startup readers | Same shared GETs, not three sets of requests |
| Navigation / type selection / foreground or Web tab return within 60 seconds | 0 extra badge-source GETs; ordinary screen content requests may still run |
| Concurrent readers at cache expiry | One GET per stale source, shared across readers |
| Accept invitation | One response POST; local invitation count decreases immediately; collection metadata reloads once (Web also reconciles received invitations) |
| Decline invitation | One response POST; local count decreases immediately (Web also reconciles received invitations) |
| Accept / decline friend request | One response POST; local request count decreases immediately; ordinary friends list may refresh |
| Relevant Push / Web bell-count event | Only relevant source(s), coalesced over two seconds, with one trailing refresh |
| 429 | No new badge-source HTTP during Retry-After; last known values remain, no repeating failure timer |
| Logout | No newly scheduled old-account reads; already-issued transport requests may finish but cannot restore its badge state |

The Mobile cache-expiry/API-helper regression checks three startup GETs, zero extra GETs over repeated visits/foreground reads, and exactly three shared GETs at 60 seconds. The Chrome regression records fixture calls to verify three initial badge reads and no extra reads on focus/visibility return within the cache window. Mutation/read-all, failure recovery and account-isolation checks exercise the same stores. Production traffic was not replayed and limits were not modified.

## Layout

- Web sidebar: inline end-aligned badge; unchanged icons/labels/routes and existing active styles. Incoming friends show on 친구 only; 설정 carries no badge (Mobile mirrors the friend number on its 내 페이지 tab because that is its account destination).
- Web collection types: inline centered badge within the existing buttons; desktop and wrapping narrow toolbar retain their normal click targets.
- Mobile bottom tabs: React Navigation's built-in badge positioning, existing icon/touch/Safe Area behavior. Both Android/iOS use the same code.
- Mobile collection filters: label flexes within the row, badge sits at its inner end and vertical center. No absolute top/end positioning or border overlap.
- Web spacing cause: `.page` section gap and invitation-card bottom margin both contributed; an empty invitation section also consumed a gap. A single `.sections` flex group now owns 12px gaps between toolbar, optional invitation card and search. Invitation margin is zero; a settled empty invitation component returns null. No negative margins.

## Verification

- `apps/web/tests/attentionState.test.ts`: zero/multiple events, overlap, same portable implementation on Mobile, immediate mutations, read vs. answer, cache/dedup, failure retention, Retry-After, account changes, late responses and complete pagination.
- `apps/web/tests/browser/collectionInvitations.browser.mjs`: real Chrome with actual AppShell/CollectionsView and isolated fixtures. Measures badge containment/vertical centering and sidebar end alignment at 1280/393/320px; both gaps equal 12px, zero invitations leaves one 12px gap; checks 99+, read-all preserving tasks, account switch, accept/decline/stale/error/auth flows.
- Mobile `attention` tests: actual API-helper reuse, account lifecycle, foreground caching, trailing Push burst refresh, logout safety. Navigation tests render built-in badges with a 320px Safe Area fixture. Collection screen tests cover four filter badges on Android/iOS code paths, inline layout styles and reset.
- Native render tests do not execute Yoga/native layout and are not device screenshots. Android/iOS physical layout and actual Push delivery must be reported separately from these tests.
- No real production invitation or friend request is created/accepted/declined by these tests.

### Stabilization follow-up

- The initial full Mobile run exposed 15 locale parity failures: `history.errorNetwork` / `history.errorServer` were missing from ja, zh-Hans, zh-Hant, es, fr, de, it, pt-BR, vi, th, id, ru, tr, ar and hi. Korean and English already had both keys. Each missing locale now supplies its own network/server copy; the 17-language bundled-resource and English fallback policies are unchanged. A runtime translation regression checks all locales and unsupported-language fallback.
- `CollectionShareScreen.tsx` now removes only the redundant `authenticatedRequest` dependency from its focus callback: the callback already depends on `load`, which depends on that request. Focus refresh and authentication dependencies therefore remain intact.
- The initial parallel run's first `CollectionUnlockDialog` case exceeded the default five seconds; it passes in the focused rerun and final full rerun without a timeout increase. No test was skipped and the default timeout was unchanged.

### Results (2026-10-23)

| Check | Result |
| --- | --- |
| Web full Node tests | 871 / 871 pass |
| Chrome full invitation/badge regression | 8 / 8 pass |
| Chrome final console-error / exception capture and geometry scenario | 1 / 1 pass, no console errors or uncaught exceptions in the captured scenario |
| Mobile full Jest, default timeout | 3,106 / 3,106 pass; 213 / 213 suites pass; no skipped tests or timeout increase |
| Mobile attention lifecycle / API helper / store targeted tests | Account changes, foreground, actions, cache expiry and concurrent reads covered; included in full run |
| Mobile collection type / bottom navigation regressions | Pass in full run, including Android/iOS branches and 320px Safe Area fixture |
| Mobile TypeScript | Pass |
| Web TypeScript / ESLint / production build | Pass; final rerun recorded in local test logs |
| Mobile changed-file ESLint | Covered by full lint; no errors; style/test warnings remain |
| Mobile full ESLint | 0 errors, 85 existing/style warnings after stabilization |
| Physical Android / iOS screenshots | Not verified: no ADB target detected; Windows host cannot run iOS native UI |

Screenshots from the real Chrome fixture run are saved under the Windows temp directory `juple-attention-screenshots-final`: `attention-1280.png`, `attention-393.png`, `attention-320.png`, `attention-count-0.png`, `attention-count-101.png`, plus invitation card/modal examples. These are fixture views, not deployed production UI.

Actual production invitation/friend mutations, production Push receipt, native device pixel placement and >200 pending-friend exact totals are not marked PASS. Production deployment remains a separate step from this source-management round.

## Changed files

- `apps/mobile/App.tsx`
- `apps/mobile/src/attention/__tests__/AttentionProvider.test.tsx`
- `apps/mobile/src/attention/__tests__/attentionState.test.ts`
- `apps/mobile/src/attention/__tests__/mobileAttention.test.ts`
- `apps/mobile/src/attention/attentionContext.ts`
- `apps/mobile/src/attention/AttentionProvider.tsx`
- `apps/mobile/src/attention/attentionState.ts`
- `apps/mobile/src/attention/mobileAttention.ts`
- `apps/mobile/src/collections/api/collaborationApi.ts`
- `apps/mobile/src/collections/api/collectionsApi.ts`
- `apps/mobile/src/friends/api/friendsApi.ts`
- `apps/mobile/src/i18n/__tests__/historyErrors.test.ts`
- `apps/mobile/src/i18n/locales/ar.json`
- `apps/mobile/src/i18n/locales/de.json`
- `apps/mobile/src/i18n/locales/es.json`
- `apps/mobile/src/i18n/locales/fr.json`
- `apps/mobile/src/i18n/locales/hi.json`
- `apps/mobile/src/i18n/locales/id.json`
- `apps/mobile/src/i18n/locales/it.json`
- `apps/mobile/src/i18n/locales/ja.json`
- `apps/mobile/src/i18n/locales/pt-BR.json`
- `apps/mobile/src/i18n/locales/ru.json`
- `apps/mobile/src/i18n/locales/th.json`
- `apps/mobile/src/i18n/locales/tr.json`
- `apps/mobile/src/i18n/locales/vi.json`
- `apps/mobile/src/i18n/locales/zh-Hans.json`
- `apps/mobile/src/i18n/locales/zh-Hant.json`
- `apps/mobile/src/navigation/__tests__/MainTabsAttention.test.tsx`
- `apps/mobile/src/navigation/MainTabs.tsx`
- `apps/mobile/src/notifications/notificationsApi.ts`
- `apps/mobile/src/screens/__tests__/CollectionsScreen.test.tsx`
- `apps/mobile/src/screens/CollectionShareScreen.tsx`
- `apps/mobile/src/screens/CollectionsScreen.tsx`
- `apps/mobile/src/screens/FriendsScreen.tsx`
- `apps/mobile/src/screens/MyPageScreen.tsx`
- `apps/web/app/(app)/AppShell.tsx`
- `apps/web/app/(app)/AttentionBadge.module.css`
- `apps/web/app/(app)/AttentionBadge.tsx`
- `apps/web/app/(app)/collections/[collectionId]/CollectionDetailsView.tsx`
- `apps/web/app/(app)/collections/CollectionSections.module.css`
- `apps/web/app/(app)/collections/CollectionsView.tsx`
- `apps/web/app/(app)/collections/ReceivedInvitations.module.css`
- `apps/web/app/(app)/collections/ReceivedInvitations.tsx`
- `apps/web/app/(app)/me/friends/page.tsx`
- `apps/web/app/(app)/notifications/useNotificationActions.ts`
- `apps/web/app/(app)/useAttention.ts`
- `apps/web/lib/attentionState.ts`
- `apps/web/lib/collectionsView.ts`
- `apps/web/tests/attentionState.test.ts`
- `apps/web/tests/browser/collectionInvitations.browser.mjs`
- `apps/web/tests/browser/harness/invitations.page.tsx.tpl`
- `apps/web/tests/itemEditing.test.ts`
- `docs/attention-badges.md`
