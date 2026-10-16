# Juple Release Backlog

> Last audited: 2026-10-16<br>
> Scope: repository code/IaC/docs plus read-only Azure observations<br>
> Rule: this file is the single source of truth for release, cost, performance, security, parity, and iOS follow-ups.

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
- GUID Blob names are naturally immutable, but uploads do not set `Cache-Control`. ETag revalidation only helps when the exact SAS URL is reused.
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
| PRE-01 | IN PROGRESS | P1 | Item uploads now normalize server-side to metadata-free WebP with decoded pixel/dimension limits and a list thumbnail; existing item blobs remain readable and are not migrated. Profile/collection normalization and the non-production corpus/E2E gate remain. | FREE | Profile/collection format and alpha policy; DEV corpus validation | Corpus byte comparison; orientation/alpha tests; Android/Web upload E2E; old asset compatibility |
| PRE-02 | IN PROGRESS | P1 | Account-deletion jobs now expose pending count, oldest age, failed count, and repeated-failure count through non-empty structured logs without identity data. An actionable production alert/dashboard threshold remains. | FREE | Choose log query/alert threshold | Forced best-effort logout failure still shows success; failed Entra deletion appears without PII; aging alert fires |
| PRE-03 | OPEN | P0 | Finalize Terms enforcement activation sequence. Production IaC/live flag remains disabled. | FREE | Approved Terms version/date and client compatibility | DEV/closed acceptance, rejection, re-prompt, and legacy-client behavior; production change record |
| PRE-04 | OPEN | P0 | Raise `MinimumSupportedBuild` to 26 only after store rollout. Live latest/minimum is 25/24. | FREE | Build 26 availability and adoption | Older build receives intended upgrade gate; build 26 signs in and completes critical flows |
| PRE-05 | OPEN | P1 | Complete 100/500/1000 seeded-data tests for Home, Archive, Collections, and Collection Details. This closes rendering and paging uncertainty without production load. | FREE | Non-production seed/cleanup utility | API call count, SQL duration/reads, Mobile memory/frame behavior, Web DOM/interaction profile captured |
| PRE-06 | DONE | P1 | Archive name-order SQL keyset optimization completed in `c70e887`; no new index required by current evidence. | FREE | None | Existing integration tests plus recorded DEV SQL reads/CPU comparison |
| PRE-07 | DONE | P1 | Public sharing excludes private uploaded item images and exposes only external preview images. | FREE | None | DTO/store contract test and public viewer smoke test |

## CLOSED-TESTING

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| CT-01 | IN PROGRESS | P1 | Item main/thumbnail selection, immutable private cache metadata, replacement, and cleanup have automated coverage. Complete Android/Web DEV network and rendered-quality verification before rollout. | FREE | PRE-01 DEV deployment | Network trace shows thumbnail on lists, display asset on detail, long-lived cache reuse, and no orphan after cleanup |
| CT-02 | OPEN | P1 | Test SQL Basic under representative concurrent flows and prepare a monitored S0 rollback. Low averages support a trial; peak headroom is narrow. | FIXED MONTHLY | PRE-05; metrics query and rollback owner | p95/error/timeout/worker/session targets pass; rollback restores S0 and connectivity |
| CT-03 | IN PROGRESS | P1 | Web ordinary collection views now use the existing SQL name-order cursor instead of loading and sorting up to 500 rows in the client. DB collation comparison and 100/500/1000 cross-client verification remain. | FREE | Product decision on locale semantics | 100/500/1000 order/paging tests on Web/Mobile; no missing/duplicate rows |
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
| POST-07 | OPEN | P2 | Reassess copying external link previews only if privacy, availability, or third-party transfer latency is a measured problem. | VARIABLE | Metrics, SSRF design, retention/deletion policy | Bounded fetch security tests, byte savings, cache hit rate, failure fallback, deletion |

## COST

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| COST-01 | OPEN | P1 | Trial SQL Basic after CT-02. Indicative saving is about $10.66/30 days; capacity drops to 5 DTU, 2 GiB, and half the worker/session limits. | FIXED MONTHLY | CT-02 and rollback owner | Production canary meets latency/error/DTU/session thresholds; S0 rollback exercised |
| COST-02 | IN PROGRESS | P1 | Push dispatch, metadata retry, deletion cleanup, and billing reconciliation now suppress empty/no-work summaries while retaining warning/error logs. Recovery cadence stays unchanged pending the Service Bus latency gate. | FREE | Queue age/worker health query and acceptable recovery SLA | Push delivery normal; recovery SLA passes; executions/log bytes fall near expected rate |
| COST-03 | IN PROGRESS | P1 | Production configuration now sets EF command logging to `Warning`; production deployment and log-volume/diagnostic confirmation remain. Current information logs produced about 9.5k command rows in seven days. | FREE | Deploy through the approved production release and confirm slow/failure observability | Failed/slow diagnostics remain; ordinary `Executed DbCommand` volume drops |
| COST-04 | IN PROGRESS | P2 | Billing worker has a Service Bus KEDA trigger and missed-event reconciliation, so min replica zero is technically wakeable. Measure DEV cold-start/RTDN latency before proposing any production scale change. | FREE | DEV cold-start measurement and CT-04 | No lost/late messages; queue drains within SLA; replica/compute reduction measured |
| COST-05 | DONE | P2 | Keep Log Analytics at 30 days and avoid blanket platform diagnostic categories until a concrete incident/query needs them. | FREE | None | Required Container Apps logs and security/error evidence remain searchable |
| COST-06 | DONE | P2 | Do not add a generic Blob age lifecycle rule. Valid user content has no safe global age and application cleanup already owns deletion. | FREE | None | Item/account/orphan cleanup tests and periodic orphan metric |
| COST-07 | DONE | P1 | Blob public access and shared-key access are disabled; Blob and Service Bus runtime access use managed identity. | FREE | None | Azure config/IaC review and runtime smoke test |

## PERFORMANCE

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| PERF-01 | IN PROGRESS | P1 | New item uploads generate normalized main and thumbnail WebP variants without retaining the original. Profile/collection normalization and final DEV corpus comparison remain under PRE-01. | FREE | PRE-01 remaining scope | Representative corpus and list/detail network/memory comparison |
| PERF-02 | IN PROGRESS | P1 | Immutable item/profile/collection blobs now receive long-lived private cache metadata, and item DTOs expose thumbnail variants. The 15-minute authorization window is unchanged; a stable client cache key across renewed SAS queries still needs design/measurement. | FREE | Asset URL/security design | Repeated navigation uses browser/device cache; authorization expiry still works; same Blob signed once per response |
| PERF-03 | IN PROGRESS | P1 | Web Home now follows the existing cursor contract with first/next loading, refresh, retry, and end states. Complete 100/500 seeded DEV verification. | FREE | PRE-05 seed data | 100/500 seeded Home flows have no missing/duplicate items on Web/Mobile |
| PERF-04 | IN PROGRESS | P2 | Mobile Archive append dedupe now uses an ID Set while preserving order and refresh behavior; affected regression tests pass. A 1000-row JS profile remains. | FREE | PRE-05 seed data | Duplicate-page/retry/refresh tests and 1000-row JS profile |
| PERF-05 | IN PROGRESS | P2 | Web collection name sorting now uses SQL cursor paging and no longer performs a capped 500-row client load/sort. Complete the CT-03 locale decision and seeded scale verification. | FREE | CT-03 locale decision | Stable cursor and identical accepted ordering on 100/500/1000 data |
| PERF-06 | OPEN | P2 | Profile Web accumulated-list DOM at 500/1000; use bounded retention/windowing only if interaction and memory cross an agreed threshold. | FREE | PRE-05 profile | Scroll, focus, back navigation, accessibility, memory, and interaction latency targets |
| PERF-07 | OPEN | P2 | Instrument Collection Details focus/header/participant requests and coalesce proven duplicates without weakening freshness. | FREE | Request correlation | Mutation and focus correctness pass; request count falls in measured scenario |
| PERF-08 | DONE | P1 | Home summary consolidates prior collection-summary calls. | FREE | None | Home code/API contract and smoke test |
| PERF-09 | DONE | P1 | Archive name order is SQL-side keyset paging with projection/AsNoTracking and no speculative new index. | FREE | None | `c70e887` evidence and integration tests |

## SECURITY

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| SEC-01 | IN PROGRESS | P1 | Item uploads enforce decoded pixel/dimension limits, apply orientation, and strip metadata through WebP re-encoding. Extend the same server-owned policy to profile/collection images. | FREE | PRE-01 remaining scope | Oversized pixel, malformed, EXIF, orientation, alpha, and content-sniff tests |
| SEC-02 | IN PROGRESS | P1 | Account-deletion pending, aging, failed, and repeated-failure aggregates are emitted without email, OID, token, secret, or response data. Production alert threshold and forced-failure alert verification remain. | FREE | PRE-02 alert decision | Sanitized forced failure and alert test |
| SEC-03 | OPEN | P2 | Migrate SQL authentication to managed identity and remove the SQL password secret after verification. | FREE | POST-02 | Least-privilege access and secret absence |
| SEC-04 | DONE | P1 | Key Vault soft delete/purge protection and SecretNearExpiry alert are present. | FREE | None | Azure/IaC observation and test notification ownership |
| SEC-05 | DONE | P1 | No request/response body logging was found; retain this property while reducing verbose logs. | FREE | None | Log sampling of auth, deletion, billing, and metadata failures contains no credentials/tokens/body |
| SEC-06 | DONE | P1 | Public collection output does not disclose private uploaded item photos. | FREE | None | Public DTO/store contract test |

## MOBILE/WEB PARITY

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| PARITY-01 | IN PROGRESS | P1 | Item normalization is now server-owned for both clients. Profile/collection uploads still need the same server policy. | FREE | PRE-01 remaining scope | Identical stored dimensions/format for Mobile and Web uploads |
| PARITY-02 | IN PROGRESS | P1 | Web now follows the shared Home cursor contract already used by Mobile. Complete the cross-client seeded-data test. | FREE | PERF-03 DEV verification | Shared cursor contract and cross-client seeded-data test |
| PARITY-03 | IN PROGRESS | P2 | Web now uses the server name-order semantics and cursor used by the API instead of locale sorting a capped client set. Cross-client collation fixtures remain. | FREE | CT-03 locale decision | Cross-client order/cursor fixtures including Korean/Latin/case/null titles |
| PARITY-04 | DONE | P1 | Core signed-in Web collections, participants, visibility, history, and editing parity was delivered by the current release series. Keep scenario tests to detect drift. | FREE | None | Existing Web/Mobile scenario matrix and release smoke tests |

## IOS

| ID | Status | Priority | Work / reason | Cost class | Dependency | Verification |
|---|---|---:|---|---|---|---|
| IOS-01 | OPEN | P1 | Configure `IOS_APP_ID`, AASA content, Associated Domains entitlement, and universal-link routing. The route currently returns 404 while the production value is empty. | NEGLIGIBLE | Apple team/bundle ID and signed iOS build | Apple CDN/AASA validation plus installed/not-installed universal-link tests |
| IOS-02 | OPEN | P2 | Implement and test iOS share/shortcut equivalents for intentional Android-only entry points where product parity requires them. | VARIABLE | iOS release scope and Apple signing | Share URL/text from Safari and supported apps; shortcut/navigation smoke tests |
| IOS-03 | OPEN | P1 | Add App Store billing products, receipt/server notification path, restore, and subscription-state parity before iOS billing launch. | VARIABLE | CT-04 billing contract and App Store Connect | Sandbox purchase/restore/renew/cancel/grace/refund matrix |
| IOS-04 | OPEN | P1 | Complete iOS build/signing, permissions, privacy manifest, and release-device regression plan from architecture follow-ups. | VARIABLE | Apple developer access and supported device matrix | Archived signed build, store validation, permissions, auth, links, images, deletion, and notification E2E |

## Ordered next actions

1. Complete PRE-03/PRE-04 launch gates and PRE-05 seeded scale tests.
2. Design PRE-01 as an existing-API image change, then validate through CT-01 before rollout.
3. Apply the two low-risk log/job reductions only after their stated measurements: COST-02 and COST-03.
4. Run CT-02 and decide on COST-01 from measured concurrency and rollback evidence.
5. Keep POST-01, SQL managed identity, CIAM cleanup, FCM FID, and external-thumbnail storage in their explicit post-launch tracks.
