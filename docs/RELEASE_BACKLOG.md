# Juple Release Backlog

> Last audited: 2026-10-16 (performance validation on DEV `0853477` added the same day)<br>
> Scope: repository code/IaC/docs plus read-only Azure observations<br>
> Rule: this file is the single source of truth for release, cost, performance, security, parity, and iOS follow-ups.

## Production state (2026-10-16)

`6e98a3d` is live in Production: API `ca-juple-api-prod--0000013`, Web `ca-juple-web-prod--0000010`, notification worker `--0000003`, billing worker `--0000003`, and the push-dispatch, billing-reconcile, blob-cleanup and retention Jobs - all backend workloads on one image (`juple-api@sha256:3f59e3378ce7...`, OCI revision label = the commit). Only the image changed, plus the API's EF command log level (`Warning`); billing program (unset = off), MobileVersionPolicy (Android 25/24), Terms enforcement (off), Production Entra and scale were unchanged. PRE-08 and PERF-10 (server side and Web) are therefore in Production; the Mobile half of PERF-10 ships with the final v26 build (built from `6e98a3d`, installed on the test device, not uploaded to Play).

## How to use this document

- Status: `OPEN`, `BLOCKED`, `DEFERRED`, `PARTIAL`, or `DONE`.
- Priority: `P0` release blocker, `P1` high, `P2` planned, `P3` opportunistic.
- Cost class: `FREE`, `NEGLIGIBLE`, `VARIABLE`, or `FIXED MONTHLY`.
- `DONE` entries stay here when they prevent a completed investigation from being reopened.
- Production load generation, Azure mutations, and performance code changes were not performed during this audit.
- New fixed-cost services such as CDN, Front Door, Redis, and a separate image-processing service are not the primary path.

## Audit conclusions

### Image pipeline

The current system has two distinct image paths. User images are copied to Juple Blob Storage without server-side resizing or transcoding. Link and Instagram preview images remain external URLs and are downloaded by the viewing client; Juple does not copy them to Blob Storage.

| Flow | Download/upload location | Storage and original | Resize/transcode/quality | Limits and dimensions | Content/cache | Duplication and deletion |
|---|---|---|---|---|---|---|
| URL metadata / OG image | Backend downloads HTML and resolves an image URL in `backend/src/Juple.Infrastructure/UrlMetadata/UrlMetadataResolver.cs:31-52`; Mobile/Web subsequently load the external image | External URL only; no Blob copy and no retained source image | None | HTML response capped at 1 MiB; image bytes and dimensions are not inspected | Controlled by the external host | Same URL may be fetched again after the ten-minute process-local cache expires; no Juple Blob to delete |
| Instagram metadata image | Backend resolver first; Mobile device fallback only when title/image remains missing (`apps/mobile/src/urlMetadata/instagramDeviceFallback.ts:12-25`) | External URL only | None | External image is not byte or pixel bounded by Juple | External host controls MIME/cache | Retry is bounded; no Juple Blob to delete |
| Item photo | Mobile/Web upload multipart; backend writes through `ItemImageStore` (`backend/src/Juple.Infrastructure/Images/ItemImageStore.cs:64-117`) | New GUID Blob under `items/{userId}/{itemId}/`; current original bytes are kept as the only display asset | **No server resize, transcode, or quality setting.** Mobile item picker also sends the compatible source without dimensions/quality (`apps/mobile/src/screens/ItemDetailsScreen.tsx:473-507`); Web sends the source (`apps/web/lib/itemEdit.ts`) | 10 MiB; JPEG/PNG/WebP magic bytes only (`backend/src/Juple.Application/Images/UploadItemImage/UploadItemImageService.cs:7-34`); no maximum pixel dimension | Source `Content-Type` is set; no `Cache-Control` (`ItemImageStore.cs:84-87`) | Every replacement gets a GUID; replacement/orphan cleanup is best effort, item/account prefix deletion exists (`ItemImageStore.cs:224-289`) |
| Collection icon | Mobile picker normalizes to at most 512 px and quality 0.8 (`apps/mobile/src/collections/collectionIconImage.ts:30-48`); Web can send the source | One GUID Blob under the owner/collection prefix | Mobile only; **no backend or Web normalization** | Backend 5 MiB; no server pixel limit (`backend/src/Juple.Application/Collections/SetCollectionIconImage/SetCollectionIconImageService.cs:10-34`) | Source `Content-Type`; no `Cache-Control` | Replacement deletes the prior Blob best effort; owner/account cleanup exists |
| Profile image | Mobile reuses the 512 px, 0.8 picker (`apps/mobile/src/screens/ProfileEditScreen.tsx:43`); Web can send the source | One GUID Blob under `items/{userId}/profile/` | Mobile only; **no backend or Web normalization** | Backend 5 MiB; no server pixel limit (`backend/src/Juple.Application/Users/Profile/UserProfile.cs:74-75`) | Source `Content-Type`; no `Cache-Control` | Replacement deletes the prior Blob best effort; account prefix cleanup exists |
| Screenshot | No product screenshot capture, upload, or storage pipeline was found | None | N/A | N/A | N/A | N/A |
| Public share image | Public collection DTO returns only the external `PreviewImageUrl` (`backend/src/Juple.Infrastructure/Collections/PublicCollectionStore.cs:86-101`) | Private user-uploaded item images are not exposed by public sharing | None | External image constraints apply | External host controls delivery | No Juple Blob copy or cleanup |

`ImageFormatDetector` validates file signatures but does not parse width/height. Thus decompression bombs or very large pixel dimensions can pass the byte limit. The immediate path should run normalization inside the existing API process:

1. Item photos: auto-orient, strip metadata, cap the long edge at 1600 px, produce WebP around quality 80, and create a 512 px WebP thumbnail around quality 75. Keep only normalized display and thumbnail assets because the current product has no original-download feature.
2. Profile and collection images: normalize server-side to one 512 px WebP around quality 80 so Mobile and Web behave consistently.
3. Store explicit width/height and asset version, set long-lived immutable `Cache-Control` on GUID paths, and return a stable asset URL or stable cache key.
4. Validate decoded pixel count as well as file bytes. Preserve alpha with WebP alpha or a bounded PNG fallback.

Expected savings must be verified on a representative corpus. A typical 12 MP JPEG of 3–8 MiB often becomes roughly 200–700 KiB at 1600 px WebP, while a 512 px thumbnail is often 30–120 KiB. This suggests about 70–95% stored/display-byte reduction and 80–98% list-card transfer reduction, but these are estimates, not guarantees.

Copying external link thumbnails into Juple Blob is deferred. It would improve privacy and availability but would create Juple storage, transaction, and egress cost where today there is none. If metrics justify it, store no original: fetch with SSRF protections and strict byte/pixel/type limits, normalize to at most 1200–1280 px WebP quality 75–80 plus a 320/512 px thumbnail, and deduplicate by content hash.

### Blob and network

- Read SAS URLs start five minutes in the past and expire after 15 minutes (`backend/src/Juple.Infrastructure/Images/ItemImageStore.cs:292-364`). A new query string is minted when an API response is built, so browser cache keys can change even when the Blob is unchanged.
- GUID Blob names are immutable, and uploads set `Cache-Control: private, max-age=31536000, immutable` (PERF-02). But the platform caches (Fresco, the iOS URL cache, the browser) key on the exact URL, SAS query included, so a new SAS meant a new download. PERF-12 makes the URL identical within a 30-minute UTC window.
- Mobile stabilizes collection/profile URLs in memory by asset version (`apps/mobile/src/collections/collectionIconImageCache.ts`, `apps/mobile/src/profile/profileImageCache.ts`). Item images and Web have no equivalent stable mapping.
- Collection item reads sign representative and cover images while iterating rows (`backend/src/Juple.Application/Collections/GetCollectionItems/GetCollectionItemsService.cs:75-120`). The same Blob can be signed twice for one row. Delegation keys are cached, so this is mostly local CPU/payload/cache churn rather than one Azure request per signature.
- Public sharing intentionally sends external preview images and excludes private uploaded images. This is a privacy boundary worth retaining.
- Live Blob header enumeration was unavailable to the auditing identity because it lacks Storage Blob Data Reader. Code and SDK upload options establish that the application does not set cache headers; storage keys were not used to bypass RBAC.

### Web performance

The existing production build artifacts show approximate route JS totals below. Values are raw/gzip sums of route-referenced chunks and can double-count shared chunks across routes; they are a comparison aid, not downloaded-byte telemetry.

| Route | Raw | Gzip | Main observation |
|---|---:|---:|---|
| Home | 482.3 KiB | 125.1 KiB | Interactive authenticated client route; Home list is capped at 50 with no next page |
| Archive | 475.7 KiB | 123.5 KiB | Keyset pagination and lazy images; accumulated DOM grows with all loaded rows |
| Collections | 468.3 KiB | 121.0 KiB | Infinite paging; collection-name mode later hits the 500-item whole-load cap in details |
| Collection Details | 555.4 KiB | 146.4 KiB | Largest route; header/participant refreshes and name-mode whole-load are candidates to measure |

- The dependency set is small: Next, React, and MSAL dominate. Signed-in routes require authentication, so splitting MSAL is not automatically a win. Profile with real route navigation before changing boundaries.
- `apps/web/app/(app)/HomeView.tsx:73-106` performs page/count together and a separate consolidated Home summary request. The summary already replaced several collection-list calls and is `DONE`; Home pagination beyond the first 50 is still missing.
- Archive and collection time order use IntersectionObserver pagination. `apps/web/app/(app)/SavedLinkList.tsx` renders every accumulated row; images are lazy, but 500–1000 rows still grow DOM and React work.
- `apps/web/app/(app)/LinkImage.tsx:29-34` uses a plain lazy `<img>`. There is no responsive thumbnail source, so list cards can download full user uploads.
- Collection detail participant changes can refresh both collection header and participant data. Keep correctness, then measure and coalesce only if traces show duplicate cost.
- Next link prefetch and `cache: 'no-store'` favor freshness. Do not disable them globally without request telemetry.

### Mobile performance

- Core high-volume screens use `FlatList`, not a large `ScrollView`: Date History has `initialNumToRender=12`, `windowSize=7`, and clipping (`apps/mobile/src/screens/DateHistoryScreen.tsx:461-522`); Daily Inbox, Collections, and Collection Details use similar bounded windows.
- Pagination is present. Archive uses 30-item pages in shared logic; other high-volume views generally use 24/25/50-sized pages within the API maximum of 100.
- `apps/mobile/src/items/useArchiveSearch.ts:150` deduplicates each appended row with `previous.some`, which becomes quadratic as the loaded array grows. A `Set` of known IDs is a small free improvement after correctness tests.
- Collection/profile images are 512 px on Mobile, but item photos are not resized and can consume camera-resolution memory in list/detail views.
- Screen-focus refreshes preserve cross-device freshness. Collection Details reloads collection metadata and items on focus (`apps/mobile/src/screens/CollectionDetailsScreen.tsx:680-891`) and also loads related preferences/participants. Instrument before coalescing; do not remove focus refresh wholesale.
- Metadata resolution is reused within a save flow, including a pending device fallback promise. No unbounded duplicate fetch loop was found.

### 100 / 500 / 1000 saved links

| Area | 100 | 500 | 1000 | Assessment |
|---|---|---|---|---|
| Archive API/DB | About 4 app pages at 30 | About 17 | About 34 | SQL keyset pagination and `Take(limit + 1)` scale structurally; leading-wildcard search remains user-bounded and should be measured, not indexed speculatively |
| Archive Mobile | Virtualized, modest array | Virtualized; append dedupe cost grows | Virtualized; append dedupe and full in-memory array become noticeable | Structurally viable; replace linear dedupe and test memory in non-production |
| Archive Web | Lazy images, all 100 rows in DOM after loading | DOM/React profiling warranted | Likely client render/memory bottleneck before DB | Profile first; windowing or bounded page retention only if evidence supports it |
| Collection time order | Keyset pages | Keyset pages | Keyset pages | Structurally viable on API; client considerations match Archive |
| Collection name order | One 100-item API page | Five pages then local locale sort | Disabled above 500 and falls back to time order | Functional/performance gap; backend already has SQL keyset name sort that can be exposed without a new index |
| Home | First 50 only | First 50 only | First 50 only | Count can exceed visible results; add next-page behavior |

No production load was generated. Verification belongs in seeded DEV/closed testing with 100, 500, and 1000 synthetic links.

### Archive sort, EF Core, and API

- Archive name sorting is `DONE`. `backend/src/Juple.Api/Controllers/ItemsController.cs:57-92` accepts name order, and `backend/src/Juple.Infrastructure/Items/ItemStore.cs:480-725` performs computed SQL order plus keyset paging, `AsNoTracking`, projection, and `Take(limit + 1)`. Index `IX_Items_UserId_SavedAtUtc_Id` is configured in `backend/src/Juple.Infrastructure/Persistence/Configurations/Items/ItemConfiguration.cs:66-67`.
- Commit `c70e887` records the DEV Basic comparison: roughly 34k/48k logical reads and 0.8–1.5 s before versus about 7k/5k reads and 5–11 ms CPU after, with no schema/index change. Do not add an index without a live plan and p95 regression.
- Major read stores generally use projections, `AsNoTracking`, and keyset paging. No broad `Include` or per-row database N+1 requiring immediate remediation was found.
- Reactions are batched in two statements before image signing in `GetCollectionItemsService.cs:75-87`. Collection lists also batch people lookups.
- Collection name sort already exists in SQL in `backend/src/Juple.Infrastructure/Collections/CollectionStore.cs:994,1089-1155`, but the API only selects it for query-search name ordering (`backend/src/Juple.Api/Controllers/CollectionsController.cs:779`). Enabling it for ordinary name order can remove the 500-item client cap; verify database collation versus Mobile/Web locale collation.
- API page parameters cap requests at 100 (`backend/src/Juple.Api/Items/ItemsQueryParameters.cs:6-8`, `backend/src/Juple.Api/Collections/CollectionsQueryParameters.cs:12-14`).

### Metadata fetch

- Backend URL metadata has a ten-minute, process-local memory cache limited to 500 entries (`backend/src/Juple.Infrastructure/UrlMetadata/UrlMetadataResolver.cs:30-52`; registration in `backend/src/Juple.Infrastructure/DependencyInjection.cs:194`). It prevents short-term duplicates in one replica, not across replicas or job executions. Success and failure results both receive the same short cache behavior.
- Instagram retry discovery runs on a 30-minute window, waits one minute then four minutes, and makes at most two backend attempts (`backend/src/Juple.Application/Items/InstagramMetadataRetry/InstagramMetadataRetryService.cs:10-38`). It checks current metadata before fetching and retains exhausted work so it is not rediscovered.
- The Mobile device fallback runs only when Instagram metadata remains incomplete and at most once per save. New Link Review reuses the pending result.
- Title enrichment can issue one metadata fetch followed by separate title and preview update requests (`apps/mobile/src/urlMetadata/enrichItemTitle.ts:45-70`). This is two writes, not two external metadata fetches.
- DEV has a manual Instagram retry job; no separate production Instagram retry Container Apps Job was observed. Before adding one, confirm whether the worker/service path already owns production execution.
- A persistent normalized-URL metadata cache could reduce cross-replica external fetches, but it adds retention and invalidation behavior. Add only after external-request metrics show meaningful duplication.

### Azure cost snapshot

Read-only observations were taken on 2026-10-16. They are operational evidence, not configuration instructions.

| Resource | Current production state | Cost/performance observation |
|---|---|---|
| Container App API | Consumption, 0.5 CPU/1 GiB, min 1/max 3 | Keep one warm replica through launch; measure p95 before reducing |
| Container App Web | Consumption, 0.25 CPU/0.5 GiB, min 1/max 2 | Small fixed warm floor; no evidence supporting a change |
| Notification worker | 0.25 CPU/0.5 GiB, min 1/max 10 | Live queue consumer; push-dispatch job is recovery path |
| Billing worker | 0.25 CPU/0.5 GiB, min 1/max 4 | Billing program flag is not enabled; measure idle consumption and event/cold-start requirements before changing floor |
| Jobs | Push every minute; billing reconciliation every 15 min; Blob cleanup every 5 min; retention daily | Push recovery job is the largest avoidable job/log source; five-minute recovery may be sufficient after queue latency verification |
| Azure SQL | Standard S0, 10 DTU, max 250 GiB, 7-day short-term retention, geo-backup; current storage about 30.3 MiB | Seven-day hourly average DTU mean 0.012%, p95 0.0795%, max average 0.2625%; instantaneous hourly max reached 45%, so Basic needs a canary and rollback |
| Storage | StorageV2 Standard LRS, Hot, HTTPS/TLS 1.2, public Blob off, shared key off | No lifecycle policy; do not add a generic age deletion rule because it can delete valid user content |
| Service Bus | Basic | Already the low-cost tier used by the current design |
| Key Vault | Standard, soft delete 90 days, purge protection on | Appropriate protection; SecretNearExpiry alert exists |
| Log Analytics | PerGB2018, 30-day retention, no daily cap | Retention is reasonable; ingestion reductions should target noisy sources |
| Application Insights | Workspace based, 90-day setting, no explicit sampling | `AppRequests` was empty and no SDK instrumentation was found, so application p95/p99 is unavailable |
| Resource diagnostics | No diagnostic settings found on production Storage, SQL, Service Bus, or Key Vault; Container Apps environment sends logs to Log Analytics | Low ingestion cost, but limited platform forensics; enable only evidence-driven categories |

#### SQL S0 versus Basic

| Characteristic | Basic | Current S0 |
|---|---:|---:|
| Compute | 5 DTU | 10 DTU |
| Maximum data size | 2 GiB | 250 GiB |
| Concurrent workers/logins | 30 | 60 |
| Sessions | 300 | 600 |
| External connections | 3 | 6 |
| Short-term backup retention | 1–7 days | 1–35 days; current 7 |
| Read-scale / zone redundancy | Not available | Not enabled in current S0 |
| Korea Central retail estimate at audit | $0.1771/day, about $5.31 per 30 days | $0.5323/day, about $15.97 per 30 days |

The indicative reduction is about $10.66 per 30 days, or 66.7%, before agreement discounts and tax. Basic has half the DTUs and connection limits and a much smaller storage ceiling. Storage usage fits, but the observed 45% S0 instantaneous peak corresponds to about 4.5 DTUs, close to Basic's ceiling. Closed testing should replay representative concurrent login, Home, Archive name-sort, collection, metadata, billing, and deletion traffic, then use a monitored production canary with a predefined S0 rollback. Azure SQL tier scaling can cause a brief connection interruption; the application must tolerate retries. References: [DTU resource limits](https://learn.microsoft.com/en-us/azure/azure-sql/database/resource-limits-dtu-single-databases?view=azuresql), [DTU service tiers](https://learn.microsoft.com/en-us/azure/azure-sql/database/service-tiers-dtu?view=azuresql-db), [scale operation](https://learn.microsoft.com/en-us/azure/sql-database/sql-database-scale-up-powershell), and [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

### Log cost

In the sampled seven days, `ContainerAppConsoleLogs_CL` ingested about 229 MiB and Container Apps system logs about 30.6 MiB. The push-dispatch recovery job accounted for 6,664 executions, about 328k console rows, and 24.5 MiB. Blob cleanup generated about 11k rows/0.67 MiB; billing reconciliation about 6.3k/0.43 MiB. API console output contained about 9.5k EF `Executed DbCommand` messages.

The highest-confidence free reductions are to run the recovery push job every five minutes after verifying queue delivery, log one summary only when work/error exists, and set production EF command logs to `Warning` using the existing IaC parameter. Request timing is already off. No request/response body logging was found. Keep authentication, account deletion, billing, security, and error logs.

### Avoid premature optimization

- Do not add speculative SQL indexes while observed SQL utilization and Archive queries are healthy.
- Do not introduce CDN, Front Door, Redis, or a separate image-processing service before browser caching, thumbnails, query reuse, and logging changes are measured.
- Do not copy all external thumbnails into Blob by default; that moves third-party transfer cost to Juple.
- Do not remove Mobile focus refreshes or Web `no-store` globally; they currently provide freshness guarantees.
- Do not add a Web virtualization library until React/DOM profiling at 500–1000 loaded rows identifies a user-visible bottleneck.
- Do not reduce warm production replicas or SQL tier without concurrency, latency, error-rate, and rollback evidence.
- Do not replace an FCM registration token with Firebase Installation ID. They identify different things; establish the SDK/API contract first.

## PRE-LAUNCH

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| PRE-01 | DONE | P1 | Item uploads normalize server-side to metadata-free WebP (main 1600 px q88 + 512 px thumbnail q84) with decoded pixel/dimension limits; existing item blobs remain readable and are not migrated. DEV-verified 2026-10-16: a 3840x2400 1.6 MB JPEG with EXIF Orientation=6 became a portrait main (now exactly the 1600 px bound - the decoder previously stopped at its 3/8 step, 1440 px; it now decodes at the smallest step still covering the target) and a 320x512 thumbnail; legacy blobs render. Production Android picker smoke on 2026-10-16 produced a 1000x1600 main (78,756 B) and 320x512 thumbnail (17,272 B), with WebP content type, immutable private cache headers and no EXIF/GPS/XMP. | FREE | None | Corpus byte comparison; orientation/alpha tests; Android/Web upload E2E; old asset compatibility |
| PRE-02 | IN PROGRESS | P1 | Account-deletion jobs now expose pending count, oldest age, failed count, and repeated-failure count through non-empty structured logs without identity data. Deployed to Production 2026-10-16 (`6e98a3d`, blob-cleanup Job). An actionable production alert/dashboard threshold remains. | FREE | Choose log query/alert threshold | Forced best-effort logout failure still shows success; failed Entra deletion appears without PII; aging alert fires |
| PRE-03 | OPEN | P0 | Finalize Terms enforcement activation sequence. Production IaC/live flag remains disabled. | FREE | Approved Terms version/date and client compatibility | DEV/closed acceptance, rejection, re-prompt, and legacy-client behavior; production change record |
| PRE-04 | OPEN | P0 | Raise `MinimumSupportedBuild` to 26 only after store rollout. Live latest/minimum is 25/24 (unchanged by the 2026-10-16 deploy). Final v26 AAB built from `6e98a3d` (upload-key signed), not uploaded yet. | FREE | Build 26 availability and adoption | Older build receives intended upgrade gate; build 26 signs in and completes critical flows |
| PRE-05 | IN PROGRESS | P1 | **DEV 2026-10-16 (`0853477`, deterministic API-created fixture, cleaned up by exact id):** Home with 635 links saved today walked 13 pages of 50 - 635 unique, equal to the server count, newest-first stable, identical after refresh; the Web rendered all 635 by real scrolling in exactly the API order (about 9.1k DOM nodes, 16 MB JS heap). One collection of 520 links walked by SQL name cursor (11 pages) - 520 unique, none missing, stable across walks, `nameDesc` is the exact reverse by name key, equal names contiguous with the documented tie-break (AddedAtUtc desc, then ItemId desc) in both directions; the Web rendered all 520 in API order in both directions (the former 500-row client cap is gone). Remaining: the 1000 level, Archive, Mobile (no DEV-wired build on the test device), SQL reads/duration capture. | FREE | DEV-wired Android build; 1000-row fixture | API call count, SQL duration/reads, Mobile memory/frame behavior, Web DOM/interaction profile captured |
| PRE-06 | DONE | P1 | Archive name-order SQL keyset optimization completed in `c70e887`; no new index required by current evidence. | FREE | None | Existing integration tests plus recorded DEV SQL reads/CPU comparison |
| PRE-07 | DONE | P1 | Public sharing excludes private uploaded item images and exposes only external preview images. | FREE | None | DTO/store contract test and public viewer smoke test |
| PRE-08 | DONE | P0 | Profile and Collection icon photos are now normalized by the server whatever the client sends (`UserProfileService`, `SetCollectionIconImageService` -> `ItemImageNormalizer.NormalizeSingle`): file-signature check, decoded-dimension guard (8000 px / 32 MP) before any pixel allocation, EXIF orientation applied, every metadata block dropped, one WebP with the longest edge <= 512 px at quality 86 (largest real render is about 104 CSS px; 512 is the Mobile picker size), aspect kept (clients cover-fit as before), immutable private cache header. Replace keeps the existing order (new Blob -> row -> old Blob deleted; a failed row write deletes the new Blob and keeps the old photo). Existing Blobs are not reprocessed and keep rendering. **DEV E2E 2026-10-16 (Web):** a synthetic 3840x2400 1.6 MB JPEG with Orientation=6 and a GPS IFD became a 320x512 WebP of 18,032 B for both a profile and a collection icon, with no EXIF, GPS, XMP or marker bytes (only the sRGB ICC chunk); replacing an icon made the old Blob 404 `BlobNotFound`; 7 legacy PNG icons still served. Tests: unit (EXIF/GPS strip, orientation, 512 bound, pixel bomb, truncated file, replace/failure) and integration. | FREE | None | Done |

## CLOSED-TESTING

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| CT-01 | DONE | P1 | Web (real Blob responses): lists request `.thumb.webp`, Item Details `.main.webp`, the original is never requested; `Content-Type: image/webp`, `Cache-Control: private, max-age=31536000, immutable`, ETag, Content-Length; soft delete keeps both blobs, permanent delete makes both `404 BlobNotFound`. Cache reuse now happens (PERF-10). Android: a DEV-wired build (`dogfood`, DEV API + jupledev) on SM-S936N, measured with the app's own received bytes (`dumpsys netstats`): detail reopen 11-17 KB (was ~93 KB), Archive 8.9 KB (was 90 KB), Collections round trip 11 KB after the first load. Production v26 Android picker upload and Web main/thumbnail selection were smoke-tested on 2026-10-16. | FREE | None | Done |
| CT-02 | OPEN | P1 | Test SQL Basic under representative concurrent flows and prepare a monitored S0 rollback. Low averages support a trial; peak headroom is narrow. | FIXED MONTHLY | PRE-05; metrics query and rollback owner | p95/error/timeout/worker/session targets pass; rollback restores S0 and connectivity |
| CT-03 | IN PROGRESS | P1 | Web ordinary collection views use the existing SQL name-order cursor. 520-row Web/API verification passed (PRE-05). Observed DB collation order for the product decision: digits first, then Latin (case-insensitive - "Alpha" and "alpha" are one key, so they interleave by the tie-break), "é" sorts with "e", Hangul after Latin. Remaining: accept or change these semantics, and the Mobile cross-client and 1000-row runs. | FREE | Product decision on locale semantics | 100/500/1000 order/paging tests on Web/Mobile; no missing/duplicate rows |
| CT-04 | OPEN | P0 | Complete billing store/RTDN/reconciliation E2E before enabling the program. Google integration exists, but `Billing__ProgramEnabled` remains false. | FREE | Store products, tester accounts, approved launch date | Purchase, restore, renewal, cancellation, grace, revoke, and reconciliation pass |
| CT-05 | DONE | P1 | Core Mobile large lists use FlatList virtualization and server pagination. | FREE | None | Date History, Inbox, Collections, and Collection Details configuration/code review |
| CT-06 | DONE | P1 | URL/Instagram metadata retry is bounded and Mobile reuses its pending device fallback per save. | FREE | None | Retry service and Mobile save-flow tests/code review |

## PUBLIC-LAUNCH

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| PUB-01 | OPEN | P0 | Decide SEO scope. Current root metadata is blanket `noindex` and robots disallow `/`; public collection shares should remain private-by-link/noindex, while a future marketing root may need indexing. | FREE | Product/legal decision and public landing content | robots/meta checks on root, legal pages, auth pages, and public share URLs |
| PUB-02 | OPEN | P0 | Activate Terms enforcement after PRE-03 and monitor acceptance failures. | FREE | PRE-03 | Production canary and log query; rollback flag documented |
| PUB-03 | OPEN | P0 | Enforce MinimumSupportedBuild 26 after PRE-04 rollout threshold. | FREE | PRE-04 | Store availability/adoption gate and production upgrade-flow smoke test |
| PUB-04 | OPEN | P0 | Enable billing only after CT-04 and an explicit approved date. | VARIABLE | CT-04, support/runbook readiness | Production canary purchase/restore, webhook/queue health, reconciliation and rollback |
| PUB-05 | OPEN | P1 | Capture a launch baseline for API/Web latency, failures, queue age, SQL DTU, replicas, logs, and Blob egress before cost tuning. | FREE | p95/p99 telemetry minimum or reproducible log query | Saved dashboard/query set and dated baseline |

## POST-LAUNCH

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| POST-01 | OPEN | P1 | Add useful p50/p95/p99 request telemetry and route/dependency correlation. Application Insights currently has no application requests. | VARIABLE | Cardinality/sampling/privacy design | Known synthetic requests appear with correct route/status/duration; ingestion budget observed |
| POST-02 | OPEN | P2 | Replace SQL password connection secret with Azure SQL Managed Identity. Blob and Service Bus already use managed identity. | FREE | SQL contained-user/role migration and rollback | API/jobs connect without password secret; least-privilege reads/writes; rotation rollback |
| POST-03 | OPEN | P2 | Inventory `jupleprod.onmicrosoft.com` and `juple.onmicrosoft.com`, identify the legacy CIAM tenant, owners, apps, domains, and dependencies, then remove only with approval. | FREE | Tenant ownership and dependency export | Zero production references/sign-ins for approved observation period; recovery/owner record |
| POST-04 | DEFERRED | P3 | Resolve the old FCM FID follow-up against current Firebase APIs. Registration token is the send target; FID is not a drop-in replacement. | FREE | Firebase SDK contract and device reinstall/token-rotation test plan | Push survives token refresh/reinstall as designed; no duplicate installation records |
| POST-05 | DEFERRED | P2 | Consider a persisted normalized-URL metadata cache only if cross-replica duplicate external fetch metrics are material. | VARIABLE | POST-01/external-request metrics and TTL/privacy policy | Hit rate, stale rate, external calls, row growth, and purge behavior meet target |
| POST-06 | OPEN | P2 | Resolve contributor-item lifetime behavior documented in architecture: confirm whether collection content should survive contributor account/item deletion. | VARIABLE | Product/legal ownership decision | Owner/collaborator deletion matrix and retention/export tests |
| POST-08 | OPEN | P2 | Every Android build type (debug, dogfood, playInternal, release) shares the applicationId `com.juple.app`, so a DEV build cannot sit beside the Production app: verifying DEV on the reference phone on 2026-10-16 required uninstalling the Production app (user-approved). Consider a DEV applicationIdSuffix (needs its own Firebase client, Entra DEV redirect URI and App Links host) so DEV and Production can coexist. | FREE | Firebase/Entra DEV registrations | DEV and Production installed side by side; push, sign-in and links work in both |
| POST-07 | OPEN | P2 | Reassess copying external link previews only if privacy, availability, or third-party transfer latency is a measured problem. | VARIABLE | Metrics, SSRF design, retention/deletion policy | Bounded fetch security tests, byte savings, cache hit rate, failure fallback, deletion |
| POST-09 | OPEN | P3 | **Build hygiene; not a Closed Testing blocker.** The Production Android bundle still contains unreachable Development Entra endpoint string constants because `entraDevAuthConfig` is statically bundled. Production runtime selection was verified to use `juple.ciamlogin.com`. Remove Development-only auth constants from release bundles when build configuration is cleaned up; do not rebuild v26 solely for this. | FREE | Android build-configuration cleanup | Release bundle no longer contains the Development endpoint; Production and dogfood auth routing remain correct |

## COST

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| COST-01 | OPEN | P1 | Trial SQL Basic after CT-02. Indicative saving is about $10.66/30 days; capacity drops to 5 DTU, 2 GiB, and half the worker/session limits. | FIXED MONTHLY | CT-02 and rollback owner | Production canary meets latency/error/DTU/session thresholds; S0 rollback exercised |
| COST-02 | IN PROGRESS | P1 | Push dispatch, metadata retry, deletion cleanup, and billing reconciliation now suppress empty/no-work summaries while retaining warning/error logs. Deployed to Production 2026-10-16 (`6e98a3d`: push-dispatch, blob-cleanup, billing-reconcile, retention, both workers). Recovery cadence stays unchanged pending the Service Bus latency gate; log-volume drop still to be measured over a week. | FREE | Queue age/worker health query and acceptable recovery SLA | Push delivery normal; recovery SLA passes; executions/log bytes fall near expected rate |
| COST-03 | IN PROGRESS | P1 | Production API runs with `Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command=Warning` since the 2026-10-16 deploy (`6e98a3d`, API revision 0000013); the seven-day log-volume/diagnostic confirmation remains. Current information logs produced about 9.5k command rows in seven days. | FREE | Deploy through the approved production release and confirm slow/failure observability | Failed/slow diagnostics remain; ordinary `Executed DbCommand` volume drops |
| COST-04 | IN PROGRESS | P2 | Billing worker has a Service Bus KEDA trigger and missed-event reconciliation, so min replica zero is technically wakeable; DEV already runs it at min 0 / max 2 with the `billing-events` rule. The cold-start measurement was **not run on 2026-10-16 by decision**: injecting a probe message needs a Service Bus data-plane sender role that no current identity holds, and RBAC was not changed for it. Measure during closed testing / before billing activation with the real flow. | FREE | CT-04 real billing flow | No lost/late messages; queue drains within SLA; replica/compute reduction measured |
| COST-05 | DONE | P2 | Keep Log Analytics at 30 days and avoid blanket platform diagnostic categories until a concrete incident/query needs them. | FREE | None | Required Container Apps logs and security/error evidence remain searchable |
| COST-06 | DONE | P2 | Do not add a generic Blob age lifecycle rule. Valid user content has no safe global age and application cleanup already owns deletion. | FREE | None | Item/account/orphan cleanup tests and periodic orphan metric |
| COST-07 | DONE | P1 | Blob public access and shared-key access are disabled; Blob and Service Bus runtime access use managed identity. | FREE | None | Azure config/IaC review and runtime smoke test |

## PERFORMANCE

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| PERF-01 | IN PROGRESS | P1 | New item uploads produce normalized main + thumbnail WebP; profile and Collection icon uploads one 512 px WebP (PRE-08). DEV samples: 1.6 MB camera-size JPEG -> 70-79 KB main / 17-18 KB thumbnail / 18 KB profile or icon. A representative multi-image corpus comparison (photos, screenshots, PNG with alpha) remains. | FREE | None | Representative corpus and list/detail network/memory comparison |
| PERF-02 | DONE | P1 | Immutable item/profile/collection blobs carry long-lived private cache metadata (verified on real DEV responses) and, with PERF-10, are actually reused by Web and Android. The 15-minute authorization window is unchanged. | FREE | None | Done |
| PERF-03 | DONE | P1 | Web Home follows the cursor contract with first/next loading, refresh, retry, and end states. DEV 635-row seeded verification passed (PRE-05): no missing/duplicate/out-of-order rows, identical after refresh. Mobile cross-client remains under PARITY-02. | FREE | None | 100/500 seeded Home flows have no missing/duplicate items on Web |
| PERF-04 | IN PROGRESS | P2 | Mobile Archive append dedupe now uses an ID Set while preserving order and refresh behavior; affected regression tests pass. A 1000-row JS profile remains. | FREE | PRE-05 seed data | Duplicate-page/retry/refresh tests and 1000-row JS profile |
| PERF-05 | DONE | P2 | Web collection name sorting uses SQL cursor paging; DEV 520-row verification passed in both directions with exact API order and no client cap (PRE-05). The locale-semantics decision stays under CT-03. | FREE | None | Stable cursor and identical ordering on 500+ data |
| PERF-06 | OPEN | P2 | Profile Web accumulated-list DOM at 500/1000; use bounded retention/windowing only if interaction and memory cross an agreed threshold. First data point (DEV, desktop Chrome): 635 Home rows = about 9.1k DOM nodes and 16 MB JS heap, all pages loaded in about 11 s of scrolling with no visible stall. | FREE | PRE-05 1000-row profile | Scroll, focus, back navigation, accessibility, memory, and interaction latency targets |
| PERF-07 | OPEN | P2 | Instrument Collection Details focus/header/participant requests and coalesce proven duplicates without weakening freshness. | FREE | Request correlation | Mutation and focus correctness pass; request count falls in measured scenario |
| PERF-08 | DONE | P1 | Home summary consolidates prior collection-summary calls. | FREE | None | Home code/API contract and smoke test |
| PERF-09 | DONE | P1 | Archive name order is SQL-side keyset paging with projection/AsNoTracking and no speculative new index. | FREE | None | `c70e887` evidence and integration tests |
| PERF-10 | DONE | P1 | **Stable image cache key (no new dependency, Blob stays private, SAS lifetime unchanged).** The first signed URL per immutable photo variant (`${imageId}:thumb` / `${imageId}:main`) is kept in memory for the session and reused; a load failure of the kept URL swaps in the response's fresh URL once, a failure of the fresh URL shows the fallback (no loop). Bounded to 500 entries (oldest first), memory only, never active on the Web server side, cleared on every session end (Web `clearLocalSession` + sign-out; Mobile `setSignedOut`, which now also clears the existing Collection-icon and profile-photo URL caches that were previously never cleared). Web: `lib/stableImageUri.ts` + `LinkImage cacheKey` (lists, Item Details). Mobile: `src/images/stableImageUri.ts`, `StableImage`, list rows/grid/tiles, Item Details and its photo field. **Measured on DEV 2026-10-16:** Web - 9 in-app steps downloaded the photo twice (thumb 17,920 B once, main 79,404 B once) instead of on every Home visit/detail open; after a forced cache eviction an expired kept URL was refused once and the fresh URL loaded (one retry). Android (SM-S936N, DEV build) - see CT-01. A fresh page load / new app process requests again (new session; allowed). | FREE | None | Done |
| PERF-11 | OPEN | P2 | **Track: POST-LAUNCH.** Legacy photos uploaded before normalization have no thumbnail and are served at full size - measured on DEV: a 1.96 MB legacy PNG Collection icon shown in a small tile (Android: about 2.09 MB on the first Collections visit of each app process, then cached by PERF-10), and legacy item photos in 32 px list tiles. Consider a bounded, resumable, idempotent backfill that writes normalized variants for existing item/icon/profile Blobs (DEV first), without changing what a stored reference means. | FREE | Backfill design and rollback | Legacy assets show small variants; no row/blob loss; idempotent rerun |
| PERF-12 | DEPLOYED to PROD API 2026-10-20 (commit 131984a, image `api-131984a-prod-20261020`, revision `ca-juple-api-prod--0000029`; previous `--0000028`, digest `sha256:6b20c3e8...`, is the rollback target); effect measurement open | P1 | **Windowed read SAS so platform caches can reuse photo bytes across sessions** (no new dependency, Blob stays private, compression unchanged). Before: `CreateReadUrlAsync` signed `now - 5 min .. now + 15 min`, so every API response carried a new URL. Fresco, the iOS URL cache and browsers key on the exact URL, so a new session (or the PERF-10 kept-URI fallback) downloaded the same immutable bytes again; PROD showed 2,544 GetBlob for 12 blobs in about 9 days. Now the URL is signed for a fixed 30-minute UTC window (`ItemImageStore.ReadUrlValidity`: start = window start - 5 min, expiry = window end + 15 min, capped at the User Delegation Key's expiry). Every response for the same Blob in a window is byte-identical, so a reopen, reload or other screen in that window is served from the device's cache with no request. **Trade-off:** a URL lives 15-45 min after issue (was 15); still Read-only, HTTPS-only, issued only after the API's ownership/access checks. A replaced photo is a new GUID Blob, so it never shows stale. Account isolation is unchanged: a cached copy can only be addressed with the URL the API hands to an authorized caller; the session URI maps are still cleared on sign-out. **Not done (alternatives, need a decision):** a persistent on-device cache keyed by `imageId:variant` + account would also cover reopen after the window (Mobile needs a native file-system dependency, which was not added; Web needs a Service Worker + Cache Storage); a CDN only pays off above roughly 300 GB/month of egress. | NEGLIGIBLE (reduces egress/reads) | Production API deploy | Unit tests `ReadUrlWindowTests` (same window = identical URL, boundary, 15-45 min, key cap, read-only). After deploy: Storage `Transactions(ApiName=GetBlob)` and `Egress` per active user per day before vs after (Azure Monitor, hourly granularity); and a DEV check that two item-list calls within a window return identical `readUrl`s and that a second app start inside the window issues no Blob request (Android: logcat/Charles; Web: DevTools "(disk cache)"). **Measurement (PROD):** baseline 2026-10-13..19 (GetBlob 13/12/23/800/739/742/167 per day, egress 0.4..105 MB/day, 4 NetworkError) vs 2026-10-21..27, the same queries: `Transactions` (ApiName=GetBlob, split by ResponseType: Success vs AuthorizationError/ClientOtherError = expired or invalid SAS, NetworkError), `Egress` (ApiName=GetBlob), and DAU from Admin analytics (`UserDailyActivities`) -> GetBlob per active user per day. With 1-2 active users and one heavy 3-day period in the baseline, the comparison is indicative only; repeat when DAU >= 20. |

## SECURITY

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| SEC-01 | DONE | P1 | Item, profile and Collection icon uploads all enforce decoded pixel/dimension limits, apply orientation and strip metadata through server-side WebP re-encoding (PRE-01, PRE-08; EXIF/GPS removal verified on DEV). | FREE | None | Done |
| SEC-02 | IN PROGRESS | P1 | Account-deletion pending, aging, failed, and repeated-failure aggregates are emitted without email, OID, token, secret, or response data. Production alert threshold and forced-failure alert verification remain. | FREE | PRE-02 alert decision | Sanitized forced failure and alert test |
| SEC-03 | OPEN | P2 | Migrate SQL authentication to managed identity and remove the SQL password secret after verification. | FREE | POST-02 | Least-privilege access and secret absence |
| SEC-04 | DONE | P1 | Key Vault soft delete/purge protection and SecretNearExpiry alert are present. | FREE | None | Azure/IaC observation and test notification ownership |
| SEC-05 | DONE | P1 | No request/response body logging was found; retain this property while reducing verbose logs. | FREE | None | Log sampling of auth, deletion, billing, and metadata failures contains no credentials/tokens/body |
| SEC-06 | DONE | P1 | Public collection output does not disclose private uploaded item photos. | FREE | None | Public DTO/store contract test |

## MOBILE/WEB PARITY

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| PARITY-01 | DONE | P1 | Item, profile and Collection icon normalization is server-owned, so Mobile and Web uploads produce the same stored format and bounds. | FREE | None | Done |
| PARITY-02 | IN PROGRESS | P1 | Web now follows the shared Home cursor contract already used by Mobile. Complete the cross-client seeded-data test. | FREE | PERF-03 DEV verification | Shared cursor contract and cross-client seeded-data test |
| PARITY-03 | IN PROGRESS | P2 | Web now uses the server name-order semantics and cursor used by the API instead of locale sorting a capped client set. Cross-client collation fixtures remain. | FREE | CT-03 locale decision | Cross-client order/cursor fixtures including Korean/Latin/case/null titles |
| PARITY-04 | DONE | P1 | Core signed-in Web collections, participants, visibility, history, and editing parity was delivered by the current release series. Keep scenario tests to detect drift. | FREE | None | Existing Web/Mobile scenario matrix and release smoke tests |

## IOS

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| IOS-01 | OPEN | P1 | Configure the Apple Team ID, `IOS_APP_ID` and the AASA content, connect the Associated Domains entitlement in Xcode (the entitlements file exists but is not wired into the project), and verify `/c/*` universal links on a device. Then set the real App Store URL (`APP_STORE_URL`, `APP_STORE_APP_ID`) so the Web App Store buttons (sidebar card, mobile landing, share page) switch from "coming soon" to live. The AASA route returns 404 and the App Store buttons are disabled while these are empty. | NEGLIGIBLE | Apple team/bundle ID, App Store listing and a signed iOS build | Apple CDN/AASA validation, installed/not-installed universal-link tests, and the Web App Store CTA opening the real listing |
| IOS-02 | PARTIAL | P2 | iOS equivalents of the Android-only entry points. **Collection Home-screen shortcut: implemented (2026-10-19)** - the App Intent "컬렉션 열기 / Open Collection" (`ios/JupleMobile/CollectionShortcuts.swift`, `NativeCollectionShortcutsIOS`): the Collection menu's "홈 화면에 바로가기 추가" offers the Collection to the Shortcuts app (locked ones refused - the name would show outside Juple) and explains the Shortcuts > Add to Home Screen steps (iOS has no API for an app to create a Home icon). A run hands the id to `CollectionShortcutRouter` (same server validation as Android; signed-out waits for sign-in; cleared on sign-out). Verified on the Simulator: build, App Intents metadata, cold-start hand-off -> validation -> "no longer available" notice, single use. **Not yet verified: an actual Shortcuts run and the Home-screen icon (needs taps), and a valid Collection opening from it.** Intent strings exist in en/ko only (other languages show English). Share Extension: see IOS-09. | VARIABLE | iOS release scope | Create the shortcut in the Shortcuts app, add it to the Home Screen, open a valid / locked / deleted Collection cold and warm, signed in and out |
| IOS-03 | OPEN | P1 | Add App Store billing products, receipt/server notification path, restore, and subscription-state parity before iOS billing launch. | VARIABLE | CT-04 billing contract and App Store Connect | Sandbox purchase/restore/renew/cancel/grace/refund matrix |
| IOS-04 | OPEN | P1 | Complete iOS build/signing, permissions, privacy manifest, and release-device regression plan from architecture follow-ups. State 2026-10-19: Debug and PROD-configured Release builds run on the iOS 27 Simulator (UIScene adopted, CocoaPods with static frameworks, PROD sign-in/session restore verified); nothing has run on a real iPhone and no signing/Team is configured. | VARIABLE | Apple developer access and supported device matrix | Archived signed build, store validation, permissions, auth, links, images, deletion, and notification E2E |
| IOS-05 | OPEN | P1 | (Simulator 2026-10-19: Dark Home/tab bar look right; Light not yet checked.) On an iPhone (Light, Dark and System) confirm the bottom safe area / Home Indicator surroundings blend with the app (root `systemBackground`, tab bar surface, full-screen modals). Static audit found the structure sound (the tab bar surface draws through the inset; the root view follows the window style set by `Appearance.setColorScheme`); the Home Indicator glyph itself is the system's and is not styled. | NEGLIGIBLE | Mac/Xcode and an iPhone | Light/Dark/System switch on device with the tab bar, a pushed screen and a full-screen modal |
| IOS-06 | PARTIAL | P2 | Profile photo crop on iOS: `pod install` and compile of `@react-native-community/image-editor@5.0.0` done (2026-10-19, Simulator). Remaining: EXIF-rotated photos (crop rectangle vs. what the picker shows) on a device. | FREE | Mac/Xcode and an iPhone | Pick portrait/landscape/EXIF-rotated photos, crop, upload and compare with the preview |
| IOS-07 | DONE | P1 | Entra External ID sign-in page (PROD `juple.ciamlogin.com`, Microsoft-hosted, not Juple code): on iOS the page zoomed in (looked shifted/clipped left) when the **password** field was tapped. Cause (inferred, not measured on the input itself): the page body is 15px and inputs inherit it, below the 16px at which iOS WebKit stops auto-zooming a user-tapped field; the e-mail field is autofocused, so it never zoomed. Fix (2026-10-20, applied by hand in the Entra admin center, outside Git): Company branding > Default sign-in > Layout > Custom CSS with exactly `.ext-input.ext-text-box { font-size: 16px; }` (an officially supported selector; `font-size` is not a retired property; External ID tenants keep custom CSS). No viewport/`user-scalable` change, no other branding/auth/user-flow change. Verified by hand on the iOS Simulator: tapping the password field no longer zooms. The Entra portal is the source of truth for this setting: this row is the record of the uploaded CSS (the whole file is the rule above). Rollback: Custom CSS > remove that rule (or upload the previous file / remove the custom CSS). Android and Web sign-in regression: IOS-18. | FREE | None | Done (iOS); IOS-18 for the other clients |
| IOS-08 | OPEN | P1 | iOS Push via direct APNs (architecture decision; Notification Hubs not used). Today the app makes no Firebase Messaging call on iOS (`src/push/fcmPlatform.ts`) and registers no push device - nothing is faked as registered. Needs the APNs key, the `aps-environment` entitlement, device-token registration (`PushDeviceRegistration` with platform `ios`) and a backend APNs sender. | VARIABLE | Apple Developer Program (APNs key, push capability), backend APNs sender | Foreground/background/terminated delivery, tap routing, token rotation, sign-out unregister |
| IOS-09 | OPEN | P1 | iOS Share Extension (Android share target equivalent): save a URL/text from Safari and other apps, Quick Save on/off semantics, App Group for the hand-off. | VARIABLE | App Group + signing (Apple Developer Program) | Share from Safari/YouTube/Instagram, review vs quick save, signed-out handling |
| IOS-10 | OPEN | P2 | Firebase iOS SDK comes from CocoaPods (`$RNFirebaseDisableSPM`, static frameworks) because RNFB SPM needs dynamic frameworks, which `react-native-image-picker` does not link as. Firebase stops publishing CocoaPods releases after 2026-10: plan the move to SPM + dynamic frameworks (fix the image-picker linkage) with the next Firebase upgrade. iOS does not use Firebase at runtime today (IOS-08). | FREE | Next react-native-firebase / Firebase upgrade | `pod install` + Debug/Release Simulator and device builds with SPM |
| IOS-11 | OPEN | P2 | iOS header back control uses React Navigation's `unstable_headerLeftItems` (to hide the iOS 26 glass background behind Juple's arrow). Re-check on every `@react-navigation/native-stack` / `react-native-screens` upgrade. | FREE | Navigation library upgrades | Pushed screen, Share sheet (modal), edge-swipe back and sheet swipe-down on iOS |
| IOS-12 | OPEN | P2 | iOS UX parity items still to confirm by hand on the Simulator/iPhone: the Share sheet's back arrow, the Collections search suggestions closing on an outside touch (code fixed, unit-tested), Friend detail spacing, and the selection control the tester called heavy (which control is still to be identified). | FREE | Taps on Simulator / iPhone | Light and Dark screenshots of each |
| IOS-13 | DONE | P3 | Test hygiene: the `FriendPickerModal (Share > 친구 선택)` tests in `src/components/__tests__/AppModal.test.tsx` raced the modal's first load (requested from a `setTimeout(0)`): the helper returned before the list existed. The helper now waits (bounded) until the first page is rendered; no test skipped, no product change (2026-10-19). | FREE | None | File alone 5/5 and full suite 3/3 (2991/2991) |
| IOS-14 | OPEN | P2 | The iOS system switch (`ThemedSwitch` -> React Native `Switch`, iOS 26 style) looks heavier/thicker than Android's. Decide whether to keep the platform control or restyle; the only selection control that differs by platform (the circular `SelectionIndicator` / report radio are identical on both). | FREE | Design decision | Light/Dark screenshots of settings rows on iOS and Android |
| IOS-15 | OPEN | P1 | App Store / TestFlight preparation: Apple Developer Program team and signing, App Store Connect record for `com.juple.app`, archive and upload, privacy nutrition labels (incl. the `PrivacyInfo.xcprivacy` reasons merged by CocoaPods), export compliance, screenshots, review notes (test account), and the iOS `MobileVersionPolicy` store URL. | VARIABLE | Apple Developer Program, IOS-04 | TestFlight build installs and passes the IOS-04 regression on a device |
| IOS-16 | OPEN | P1 | **Android regression check of the iOS series (not run - no Android SDK on the Mac that made it).** On the Windows PC: `cd apps/mobile/android; ./gradlew :app:generateCodegenArtifactsFromSchema` -> `app/build/generated/source/codegen/java/com/juple/app/` contains only `NativeIncomingShareSpec.java` (no `NativeCollectionShortcutsIOSSpec.java`; codegen marks the `...IOS` module `excludedPlatforms: ['android']`, it appears only in the header-only `jni/react/renderer/components/JupleSpecs/JupleSpecsJSI.h`); then `./gradlew assembleDebug` -> BUILD SUCCESSFUL; then on a device: FCM token/foreground/background push, Collection Home icon + Direct Share, the stack back arrow, Collections search suggestions, Entra sign-in. | FREE | Windows PC with the Android SDK | Commands succeed as stated; device smoke test unchanged from before the iOS series |
| IOS-17 | OPEN | P3 | iOS launch screen (2026-10-20): the native launch screen and the React Native root view's loading view show the Juple lockup on `LaunchBackground` (#F7F9FC light / #101318 dark), so there is no white flash before the first JS frame. Limitation: a launch screen can only follow the **system** appearance; when the in-app theme differs from the system (e.g. app Dark on a Light iPhone) the first JS frame switches colors once. Option if it matters: mirror the in-app theme to native storage and apply it to the window at startup (the system launch screen itself still cannot follow it). | FREE | None | Cold start with app theme = system (no switch) and app theme != system (one switch, accepted) |
| IOS-18 | OPEN | P1 | Sign-in regression after the PROD Entra custom CSS (IOS-07): check the same hosted page on **Android** (Chrome Custom Tab: e-mail and password pages, sign-up, light/dark) and **Web** (desktop + mobile browsers) - layout, input size, error states, password reset link. Expected: only the text-box font becomes 16px. Also confirm on Android that the first-run permission onboarding title clears the status bar (it now applies the top safe-area inset when shown without a header). | FREE | Android device, Web browsers | Screenshots before/after; sign-in completes on both |

## DATA RETENTION (subscription expiry, 6 months)

> Status 2026-10-20: **Round 1 is undergoing final local validation**. The pure policy, read-only API enforcement audit, additive
> bootstrap state, bounded owner-only export, and Web/Mobile presentation code exist with unit tests. Nothing deletes data. There is no deletion Job, no
> deletion flag or retention-schedule migration applied, and the Production billing program is off (`Billing:ProgramEnabled=false`), so `DataRetentionPolicy`
> answers `NotApplicable / ProgramNotRunning` for every account. Even with the program on, no account is scheduled until a policy
> effective instant is configured (`PolicyNotInEffect`, fail closed). **Existing user data is never deleted by this work; actual
> deletion stays blocked until legal review and a separate approval.**

The pre-existing `--run-retention-cleanup` maintenance job (trash/soft-deletes and aged operational records,
`docs/data-retention.md`) is separate from this subscription-expiry policy. This round does not modify or execute it and adds no
subscription-expiry deletion job.

### Policy (business decision, adopted)

1. The clock starts at the **actual end of paid access**, not the day auto-renew was turned off. `Canceled` with a paid period still running is live.
   - A paid end before the policy took effect counts from the effective instant (no retroactive shortening).
   - **Trial-only accounts** (never paid): from the trial end, but **only for accounts created at or after the effective instant**. Accounts that existed before are never scheduled for their trial alone (`TrialBeforePolicy`); they are covered once they pay and that access ends.
2. For 6 months after that, the data is **read-only**: no new links, Collections or photos, and no edits. Reading and **export** stay available.
3. Re-subscribing within the 6 months restores full use of the same data. Nothing was moved or hidden.
4. Notices go out at +3 months ("보관 기간 종료 안내"), at +5 months ("삭제 예정 안내", with the date) and 7 days before deletion (final notice).
5. At +6 months the account's **own** data is deleted: saved links (including the trash), the Collections it owns, and its uploaded photos.
   - The **account stays**, but the purpose and period of keeping the remaining personal data need a separate review.
   - Other people's Collections and their content are never deleted.
6. A user-requested account deletion follows the existing account-deletion flow (`AccountDeletionStore`), not this policy.

### Status model (`Juple.Domain.Billing.DataRetentionPolicy`, pure, tested in `DataRetentionPolicyTests`)

| Phase | When | Clock |
|---|---|---|
| `NotApplicable / ProgramNotRunning` | the billing program is off (Production today) | never runs. **Sign-up date or trial alone never schedules anything.** |
| `NotApplicable / PolicyNotInEffect` | the program is on but no policy effective instant is configured | never runs (fail closed) |
| `NotApplicable / TrialBeforePolicy` | trial only, account created before the effective instant | never runs (not retroactive) |
| `NotApplicable / NoAccessHistory` | no paid access period and no settled trial (pending only, cancelled pending) | never runs |
| `Active` | a live paid purchase (Active, Canceled until its end, GracePeriod) or a running trial | none |
| `BillingHold` | a purchase is OnHold (the store retries payment) or Paused | read-only (R39), **clock paused** |
| `ReadOnly` (basis `PaidAccessEnded`) | the latest paid access end has passed | from max(that end, effective instant); refund/revocation ends access at its revocation end |
| `ReadOnly` (basis `TrialEnded`) | trial only, account created at/after the effective instant, trial ended | from the trial end; a later paid end replaces this basis |
| `DeletionDue` | end + 6 calendar months (UTC instant) | **eligible only**: deletion needs RET-06..RET-08 |

- The notices fall at end + 3 months, end + 5 months and deletion − 7 days, each due AT its instant (boundary tests included).
- The same inputs always give the same answer, in any time zone. That makes it safe to re-evaluate idempotently.
- A later re-subscription and expiry restarts the clock from the later end.
- **Operator-granted entitlements do not exist yet.** If added, they must count as live access and as paid access history.

### Read-only enforcement (already built, R39)

`RequireWriteAccess` returns 403 `subscriptionRequired` on the content-mutating endpoints. `AllowWhenSubscriptionExpired` keeps open account, support, bootstrap/session, push devices and billing, and `CollectionOwnedWrite` covers shared Collections. All of it is a no-op while the program is off.

For retention, the API gate audit now has a reflection meta-test: every mutating endpoint must opt into `RequireWriteAccess` or an
explicit `AllowWhenSubscriptionExpired` exception. Export and account deletion remain open. A real ProgramEnabled staging run is still
required before launch. Web and Mobile consume the server's additive retention dates; device/browser visual verification remains.

### What is deleted at +6 months, and what is not

- **Deleted (owner = the account):**
  - Items (including trash) and their ItemImages, with Blobs through the existing Blob-cleanup outbox (`AccountDeletionBlobCleanup` pattern);
  - Collections the account **owns**, with their shares, icon photo and memberships;
  - the account's comments, reactions and proposals inside those Collections (cascade);
  - the account's profile photo Blob (proposal: keep the profile itself).
- **Not deleted:** other people's Collections and the links they added. Comments by others on the account's former links go with those links (cascade, as in account deletion today).
- **Decisions needed before RET-06:**
  - (1) **Links the account added to other people's shared Collections.** `CollectionItems` (with `AddedByUserId`) points at the account's own Item, so deleting the Item removes the link from the other Collection - the known "confirmed-content lifetime" gap in `docs/architecture.md`. Other members only ever see the link's URL, title and automatic preview, never its memo or uploaded photos (`Members_SeeEveryLink_ButNeverAnotherMembersMemoOrUploadedPhotos`).
    - **Recommendation (safe default): exempt.** An Item with an active membership in a Collection the account does **not** own is not deleted; only its private parts are cleared at deletion time (memo, uploaded photos through the Blob outbox). The link stays exactly as the other members saw it. Re-evaluated in the same transaction as the delete, so a link added to someone else's Collection after the dry-run is still protected.
    - Longer-term option (product decision, schema change): a Collection-owned snapshot entry (URL, title, preview) independent of the contributor's Item. It would also fix the same gap for account deletion. Not part of the first deletion release.
  - (2) **Shared Collections the account owns that still have members.** Deleting them removes them for everyone.
    - **Recommendation:** never auto-delete a Collection that has members. From the 3-month notice on, the owner is offered in the app **(a) transfer ownership** to a chosen current member (the member accepts; their subscription is checked like any owner write) or **(b) let the members keep a copy**. Without a choice by the deletion date, the Collection is **kept read-only** for its members and excluded from the batch (listed in the dry-run as "kept: has members"). Nothing is decided for the owner silently.
    - Transfer is new work: `TransferOwnership` (Owner -> member, one transaction under the Collection row lock; the old owner leaves or becomes a Contributor; share link, password and lock rules re-checked; both notified). It does **not** move the old owner's Items: their links in the Collection are protected by rule (1).
    - A copy for a member must create **new Items owned by that member** (URL, title, preview only). The existing copy-in only adds a membership to the same Item and would still disappear with it.
  - (3) The account row, friends, push devices and notifications are kept (the policy keeps the account). The privacy-policy retention period must be reviewed (RET-09).

### Notices and export

- **Notices:** the pure due-notice/idempotency-key/final-lead rules exist and are unit-tested. The daily Job, NotificationType/push copy,
  and persisted per-period send history are not implemented. E-mail is not available (Juple stores no address). The privacy policy and
  terms must state the schedule before activation.
- **Export (local implementation):** `GET /api/v1/users/me/data-export` returns counts and bounded photo parts; recent authentication is
  required by `POST .../links`, which returns hashed-token download links valid for at most 15 minutes and one authorization claim. The token is in a URL
  fragment, removed with `history.replaceState` before a POST body submits it to the download route. The response streams ZIP entries
  directly instead of building the archive in memory or storing an export Blob. The old token-in-path GET is no longer supported.
  - The data ZIP contains account metadata, JSON/CSV links (including trash), owned Collections, shared-membership name/role, the
    person's comments and purchase records, plus profile/Collection photos. Link photos are split into size/count-bounded ZIP files.
  - The token identity determines `UserId`. Another member's private memo, uploaded photos, internal item id, member identity and comments
    are excluded; their link in an owned shared Collection is only URL/title/automatic preview. Blob reads are constrained to
    `items/{userId}/`.
  - The endpoints are feature-off by default (`DataExport:Enabled=false`), rate-limited, open while expired, and allowed before current
    Terms acceptance. `AddDataExportLinks` and `FreezeDataExportImagePlan` are applied only to `localhost,14333/JupleRetTests`;
    no development or production database was migrated.

### RET Round 1 stabilization evidence (2026-10-20, local only)

- **Repeatable integration environment:** existing `infra/local/compose.yaml` SQL Server and Azurite containers were reused.
  `infra/local/Test-Retention.ps1` uses the existing local SQL password without printing it, fixes the destination to
  `localhost,14333/JupleRetTests` plus `UseDevelopmentStorage=true`, applies migrations, and restores the calling process's environment.
  Both RET integration classes refuse remote hosts, `JupleDev`, other database names and non-emulator storage.
- **Security changes:** link issuance is serialized per user with a SQL update lock and rechecks the daily quota in the same transaction.
  Atomic token claims passed concurrent-request tests. Link JSON, handoff page and downloads use `no-store`; the page/download use
  `no-referrer` and the handoff has a hash-pinned CSP, no external assets and a 1 KiB form limit. The browser test actually posts a
  synthetic token under that CSP and verifies it is absent from HTTP URLs, Referer and the resulting DOM. Raw storage/SQL exceptions
  are no longer attached to export error logs. Request/response body logging must remain disabled for the export endpoints.
- **Resource ceilings:** default 120 seconds per summary/issuance/download, 512 MiB actual archive output per download, 100,000 records
  including Collection entries/photos, 5,000 owned/joined Collections and 6,000 archive entries. Link-photo ZIPs remain limited to
  1,000 files / 256 MiB actual photo bytes. Four concurrent downloads are permitted per API replica; metadata requests have an
  identity-scoped 10/minute limiter. Limits abort a partial download instead of silently omitting records. Cancellation propagates
  through Blob reads and archive closure; the Blob stream is disposed and the HTTP response is not owned/disposed by the writer.
- **Photo consistency:** issued data links persist the companion photo ranges. Removing a photo no longer renumbers later files;
  photos added after issuance require a new export. Links/memos are read at download time; this is not a transactionally frozen backup.
- **CSV:** formula-like values, leading controls/whitespace and full-width formula starters are neutralized for spreadsheet viewing;
  JSON retains exact source text. Spreadsheet save/re-import behavior varies, so CSV is not a universal safe interchange format.
  See [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).
- **Capability/access policy:** a person must pass the API's authenticated user policy and have a verified `auth_time` within five minutes
  to mint links (`iat`/refresh alone does not count). Billing expiry does not prevent export. Account deletion cascades grant deletion.
  Ordinary logout currently does **not** revoke already issued capabilities. Tokens now expire within 15 minutes and permit one atomic
  authorization claim, but a copied unused capability can still be used after logout or from a different session before expiry.
  This is a release blocker, not an accepted activation policy (see RET-03-SESSION below). Downloaded files cannot be revoked.
- **Mobile failures found:** Trash/Collections and other screen tests retained mounted renderers, event/i18n subscriptions, list/toast
  timers and preferences across cases. `jest.setup.js` now tracks renderer roots at the test-driver boundary and unmounts/flushes them
  within `act` after every test (including failed assertions); `restoreAllMocks` cannot disable this cleanup. Trash clears local
  preference state and the App smoke test explicitly unmounts. The real incoming-share hook ignores late unmounted responses
  and superseded queue snapshots. No skip or timeout increase was introduced.
- **Fresh-database regression found during final verification:** the existing Admin directory pagination test created only one user,
  then assumed another row already existed in the database. It now creates both pagination rows and verifies their exact IDs. This
  changes the test fixture only; the Admin product code and existing data are untouched.
- **Remaining release work:** real Android/iOS browser/download-manager QA for the new fragment/POST handoff, translation review of
  the 15 English fallback locale sets, the existing notice job/history/legal backlog, and approval for any future production action.
  Export remains disabled by default; this round performs no retention deletion or production operation.
- **Initial stabilization results (before the final single-use policy round):** Backend solution build passes with zero errors/warnings; full Unit 2,049/2,049 (including separate timeout
  and request-aborted Blob disposal cases); RET SQL/Azurite integration
  11/11; Web tests 841/841 (including a real-browser transport check), typecheck/lint/build pass; Mobile Jest 199/199 suites and
  2,997/2,997 tests, zero skipped, exit 0 in 290.7 seconds using the default 5-second test timeout. Mobile typecheck and lint pass
  (71 existing warnings, no errors). The earlier concurrent native-build run's timeout/late-update failures are retained as diagnostic
  evidence; the final Jest run was isolated from C++ compilation. No `--forceExit`, increased timeout or skipped case was used.
  Final Jest output also has zero post-test logging errors and zero delayed-exit warnings. Android arm64 `:app:assembleDogfood`
  passes offline with the documented `JUPLE_PUBLIC_WEB_HOST=dev.juple.co.kr` supplied only to the build process; the APK contains
  its JS bundle. iOS native build and real-device download QA remain unperformed on this Windows host. No APK was installed.

### Migration draft (NOT created as an EF migration yet; DDL for review)

```sql
-- billing.DataRetentionSchedules: one row per account and retention period; the Job writes it, nothing else reads it to grant access.
CREATE TABLE [billing].[DataRetentionSchedules] (
    [Id] bigint IDENTITY PRIMARY KEY,
    [UserId] bigint NOT NULL REFERENCES [users].[Users]([Id]) ON DELETE CASCADE,
    [RetentionStartedAtUtc] datetimeoffset NOT NULL,           -- the instant the period counts from (paid end or trial end)
    [Basis] tinyint NOT NULL,                                   -- DataRetentionBasis: 1 PaidAccessEnded, 2 TrialEnded
    [DeletionDueAtUtc] datetimeoffset NOT NULL,
    [RetentionEndingNoticeSentAtUtc] datetimeoffset NULL,
    [DeletionScheduledNoticeSentAtUtc] datetimeoffset NULL,
    [FinalNoticeSentAtUtc] datetimeoffset NULL,
    [CancelledAtUtc] datetimeoffset NULL,                       -- re-subscribed: the period ended without deletion
    [DryRunCountsJson] nvarchar(2000) NULL,                     -- last dry-run: counts only, never content
    [ApprovedByAdminUserId] bigint NULL, [ApprovedAtUtc] datetimeoffset NULL,
    [DeletedAtUtc] datetimeoffset NULL,
    CONSTRAINT [UX_DataRetentionSchedules_User_Start] UNIQUE ([UserId], [RetentionStartedAtUtc])
);
CREATE INDEX [IX_DataRetentionSchedules_Due] ON [billing].[DataRetentionSchedules] ([DeletionDueAtUtc]) WHERE [DeletedAtUtc] IS NULL AND [CancelledAtUtc] IS NULL;
```

### Export session revocation gate (RET-03-SESSION, 2026-10-20)

- **BLOCKED FOR RELEASE; implementation deliberately deferred by the user.** `AuthSessionController` only validates the bearer token
  with `GET /api/v1/auth/session`; there is no Juple server session registration, session credential, or logout/revocation endpoint.
  API authentication uses Entra bearer JWTs and maps the account, not an application login session. `auth_time` proves recent
  authentication; it does not supply a trusted per-application session lifecycle or report logout to Juple.
- Web logout calls MSAL `logoutRedirect`; Mobile `clearSession` removes the local secure/cache state. Neither currently revokes
  export grants at the API. **Clearing client state is not server-side token revocation.** An identity-wide revoke would affect other
  devices and still needs reliable server notification; it is not a substitute for the requested session policy.
- The browser/system-downloader route accepts the capability anonymously, with no current-session credential. It cannot prove that
  the downloader is the original authenticated session or reject a later session holding the same unused capability. The existing
  owner-scoped data queries protect other users' records but do not establish the downloader's session identity.
- **Required before enabling Export:** explicitly design/register a server session, bind grants to it, authenticate session proof at
  download authorization, atomically check session/account/ownership/permissions and consume the token, revoke unused grants on
  acknowledged server logout, and specify network-failure/offline logout behavior. Revoke unused grants on account deletion; allow
  already authorized transfers to finish within resource limits. Add cross-session, logout, concurrent logout/claim and account-delete
  race tests. Current local account-deletion tests verify FK cascade for unexpired, unused tokens without revoking another user's links.
- **Independent hardening in this round:** configuration and domain issuance reject lifetimes above 15 minutes; the conditional SQL
  UPDATE independently checks maximum age and `UseCount == 0`. Configuration cannot raise the one-use ceiling. A disconnected download
  consumes its authorization; Web/Mobile retain a prepare-links action and explain how to request fresh tokens. Automatic delivery
  completion/retry detection and real download-manager behavior still require device QA.
- **Source-management scope approved:** verify and commit/push the default-OFF implementation, with this blocker documented. This
  approval does not enable Export, Billing, any production migration/deployment, or retention deletion. No new retention deletion Job
  exists; the unrelated pre-existing trash/operational cleanup Job remains untouched.
- **Other launch gates:** real-account reauthentication E2E; Web/Android/iOS download QA; iOS native build; review all new text in 15
  fallback languages; notice scheduler and persistent delivery history; shared-Collection transfer/copy
  policy; privacy-policy/terms legal review; separate approval and design for automatic deletion.

### Final single-use policy verification (2026-10-20, source only)

- Backend solution build: zero errors (11 existing test-code/compiler analyzer warnings on recompilation). Full Unit: **2,051/2,051**,
  zero skipped. Configuration rejects lifetimes above 15 minutes and use limits other than one; domain issuance also rejects an
  overlong grant. SQL consumption independently caps old grants at 15 minutes and accepts only `UseCount == 0`, including when an
  unvalidated caller supplies a larger use setting.
- Web: **841/841**, zero skipped; typecheck/lint/build pass. This includes an actual local Chrome fragment-to-POST transport check
  under the broker CSP. Mobile: **200/200 suites, 2,999/2,999 tests**, zero skipped, exit 0 in **283.41 seconds**, default 5-second
  timeout. No late test logging or delayed-exit warning. Typecheck/lint pass (71 existing lint warnings, zero errors).
- The initial concurrent verification run had two first-test timeouts in CollectionDetails suites and then cascading overlapping
  `act` failures (2,883 passed / 114 failed). Both suites, DateHistory, Trash/Collections and the new export-retry cases pass in the
  complete isolated run. No timeout was increased, no case skipped and no `--forceExit` used. These failures are preserved as
  diagnostic evidence rather than hidden by a longer timeout.
- Android: offline arm64 `:app:assembleDogfood` passes in 4m46s, with the DEV public host supplied only to the process and restored
  afterwards. APK contains the JS bundle and only arm64 native libraries. No installation was performed. iOS native build remains
  unverified on this Windows host.
- Full Backend Integration: **959/959**, zero skipped, including all **12 RET/export/planner cases**, in 10.55 minutes. The initial
  full run was 958/959 because the Admin pagination fixture depended on an existing second user; after the fixture fix the entire
  suite was rerun and passed. Eight competing claims yield exactly one authorization; unexpired unused grants disappear on account
  deletion while another user's grant remains valid. Shared-data privacy and ZIP contents/relationships remain covered.
- Only `localhost,14333/JupleRetTests`, isolated migration-test databases on that same local SQL instance, and Azurite are used.
  Production/DEV databases and production Blob/configuration are
  untouched. Export stays OFF by default; Billing/retention policy defaults are unchanged. Git source management is authorized;
  activation, production migration/deployment and automatic deletion remain separate approvals.

### Items

| ID | Status | Priority | Work | Gate |
|---|---|---:|---|---|
| RET-01 | IMPLEMENTED; PROD APPLY WAITING | P1 | Pure policy and `Billing:DataRetention:PolicyEffectiveAtUtc` binding are implemented; null remains fail-closed and PROD is unchanged. Terms publication/legal review remains. | RET-08 |
| RET-02 | IMPLEMENTED; STAGING TEST PENDING | P1 | Reflection meta-test requires every mutating endpoint to be gated or explicitly exempt. Uploads remain gated; reads, export, billing restoration and account deletion are exempt. Unit suite passes; ProgramEnabled staging run not performed. | ProgramEnabled staging run |
| RET-03 | IMPLEMENTED DEFAULT-OFF; RELEASE BLOCKED | P1 | Streamed JSON/CSV/photo ZIP export, fragment/POST hashed capabilities, recent auth, 15-minute maximum, atomic one-use/quota limits, ownership/privacy projection and resource ceilings implemented. Session revocation is not implemented. | RET-03-SESSION + real-account reauth + Web/Android/iOS download QA |
| RET-03-SESSION | OPEN; RELEASE BLOCKER | P0 for Export activation | Server-session registration/revocation and authenticated session proof during download authorization are absent. Logout does not revoke unused grants; another session can use a copied unused grant until expiry. Deferred explicitly; client clearing is not server revocation. | Separate server-session design/implementation + security/race tests; keep Export OFF |
| RET-04 | IMPLEMENTED; I18N/QA PENDING | P1 | Bootstrap adds `dataRetention` and `dataExport`; Web/Mobile show phase, dates, read-only explanation and export. Korean/English are localized and all 17 locale key sets pass; the other 15 new strings still need translation review. | Translation + Web/Android/iOS QA |
| RET-05 | IMPLEMENTING (PURE RULES ONLY) | P1 | Due stages, stable dedup keys and the final-notice lead guard are tested. Job, NotificationType/push delivery and persistent per-period history are not implemented. | The program must be ON; RET-08 |
| RET-06 | BLOCKED; DRY-RUN PLANNER ONLY | P0 for deletion | A read-only count planner identifies owned rows and protects shared Collections/contributed links. No deletion Job, flag, approval flow or delete mutation exists. | Decisions (1)(2) above, RET-07, RET-08 |
| RET-07 | LOCAL PLANNER TEST PASS; DELETION BLOCKED | P0 for deletion | Planner integration test passes on dedicated local SQL and covers other owners, members and contributed links. Actual deletion/idempotency/re-subscribe deletion-race tests remain blocked on RET-06. | RET-06 |
| RET-08 | OPEN | P1 | Privacy policy + terms: schedule, notices, export, what is deleted, what remains. | Legal review |
| RET-09 | OPEN | P2 | Review the retention purpose/period of what remains after deletion (account row, profile, friends). | Privacy review |
| RET-10 | OPEN | P2 | Admin: retention dashboard (counts per phase, upcoming deletions, dry-run results) - counts only. | RET-06 |
| RET-11 | OPEN | P1 | Ownership transfer for an owned shared Collection (Owner -> accepting member) and the "members keep a copy" path (new member-owned Items). A Collection with members is kept read-only when the owner chooses nothing. | Decision (2); integration tests |
| RET-12 | DESIGN + DRY-RUN PROTECTION ONLY | P1 | Planner excludes Items referenced by another owner's active Collection. Clearing private memo/photos and the same-transaction re-check remain unimplemented because deletion is blocked. | Decision (1); RET-06/RET-07 |

## Ordered next actions

1. Complete PRE-03/PRE-04 launch gates and the remaining PRE-05 levels (1000 rows, Mobile).
2. Upload the already-built v26 AAB to Closed Testing only after explicit approval; keep MinimumSupportedBuild at 24 until rollout adoption supports PRE-04.
3. Measure the deployed log/job reductions over their stated windows: COST-02 and COST-03.
4. Run CT-02 and decide on COST-01 from measured concurrency and rollback evidence.
5. Keep POST-01, SQL managed identity, CIAM cleanup, FCM FID, external-thumbnail storage, and Android auth bundle hygiene in their explicit post-launch tracks.

## Permission / pricing / business-expense source round (2026-10-20)

Implemented from `1f71382`; final source review and logical Commit/fast-forward Push are authorized. Undeployed; feature activation, PROD migration, RBAC, Job creation and store changes remain separately gated. Details and local validation: [implementation and operator notes](permissions-pricing-business-expenses.md).

| ID | Status | Priority | Evidence / remaining gate |
|---|---|---|---|
| PERM-01 | IMPLEMENTED; DEVICE QA PENDING | P1 | Post-auth/Terms permission explanation, Later/Settings, OS-derived Android/iOS state, 17 locale translations. Device/reinstall/account-switch/RTL QA remains. |
| PERM-02 | IMPLEMENTED; DELIVERY QA PENDING | P1 | Android token/server error distinction, foreground/token-refresh recovery, bounded retries, unregister serialization and old-epoch guard. Real FCM grant/revoke/recovery delivery QA remains. |
| PERM-03 | OPEN; iOS RELEASE BLOCKER | P1 | iOS APNs registration/server delivery unimplemented. Permission authorization is not push delivery; preserve the existing iOS/APNs blocker. Mac build/device QA required. |
| PRICE-01 | SOURCE POLICY UPDATED; STORE CHANGE BLOCKED | P1 | USD 1.99/P1M/30-day business reference; checkout uses actual store metadata. Billing OFF and RET 6 months unchanged. |
| PRICE-02 | BLOCKED ON AUTHENTICATED STORE READ + APPROVAL | P0 for selling | Read current product/base plan/territories/prices/cohorts and official KRW price points; report notice/consent effects before approval. No numeric KRW price invented, no price mutation/activation. |
| EXP-01 | IMPLEMENTED; LOCAL VALIDATION | P1 | Admin expense CRUD, currency/status-separated dashboard/filter/trend, exact tax/FX, refunds, optimistic edits, recurring forecasts, private evidence, CSV/XLSX and audit. Default OFF. Actual authenticated Admin/API end-to-end QA remains. |
| EXP-02 | ADAPTER + JOB ENTRY IMPLEMENTED; NOT DEPLOYED | P1 | ARM daily/service RG queries with whitelist, bounded paging/retry, DB lease/dedup/corrections, estimate/invoice reconciliation. CLI DEV/PROD read succeeded in KRW; API MI Cost Query remains unverified. |
| EXP-03 | BLOCKED ON RBAC / OPERATIONS APPROVAL | P1 | Review least Cost Management Reader at required Juple RGs and shared UAMI impact; do not copy CLI user's access claim to MI. No role/resource/Job changes made. Deployment/Migration/scheduler/failure alert setup require separate approval. |
| EXP-04 | FAIL-CLOSED; REAL SCANNER QA PENDING | P0 for evidence enablement | Private blob and clamd adapter implemented. Unconfigured/unavailable scanner blocks uploads; loopback protocol fixture is not a real malware-engine certification. Validate actual EICAR, encrypted PDF and scan-limit behavior before enablement. |
| EXP-05 | MANUAL + ON-SCREEN DUE DATES | P2 | Apple Developer annual fee manual recurring cost; no supported automatic Apple fee API claimed. External upcoming-payment notifications/dispatch history remain future work. |

Existing RET-03-SESSION server-session export revocation, RET-04 language/platform QA, RET notices/legal review, ownership transfer/copy, and separately approved deletion remain blocked exactly as before. No new deletion Job and no PROD change in this round.
