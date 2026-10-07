# Architecture

## 현재 상태

`apps/mobile`(React Native CLI + TypeScript, Android/iOS 네이티브 프로젝트, Expo 미사용)과 `backend`(.NET 10 / ASP.NET Core / EF Core, Modular Monolith)가 실제로 생성되어 있다. `infra/local`에 local SQL Server + Azurite(Blob Storage emulator) 개발 인프라도 존재한다.

```text
Juple/
├─ apps/
│  ├─ mobile/       # current: React Native app
│  └─ web/          # planned
├─ backend/         # current: .NET 10 Backend
├─ infra/           # current: local dev infra (SQL Server, Azurite)
├─ docs/
└─ .github/
```

`apps/web`은 아직 구현되지 않았고, Azure production infrastructure도 아직 구성·배포되지 않았다. 이 섹션 외의 "예정" 표기(Azure 구성 방향 등)는 여전히 계획 단계이며 구현되었다는 의미가 아니다.

## 목표 플랫폼과 기술

- Mobile: React Native CLI, TypeScript, Android / iOS 동등 지원
- Web: Next.js, TypeScript
- Backend: .NET 10 LTS, ASP.NET Core Web API, EF Core 10
- Backend architecture: Modular Monolith
- Database: Azure SQL Database
- Cloud: Microsoft Azure

## Backend 모듈 경계

초기부터 Microservice로 분리하지 않는다. 하나의 배포 단위 안에서 다음 모듈의 책임과 데이터 경계를 분리하고, 필요할 때 독립 서비스로 추출할 수 있게 한다.

- Identity
- Users
- Inbox / Saved Links
- Items
- Collections
- Purchases
- Repeat Purchases
- Notifications
- Images
- AI

모든 기능을 하나의 단순 CRUD 폴더에 섞지 않으며, 모듈 간 의존성과 공개 계약을 명확히 한다.

## 인증과 데이터 소유권

외부 Identity Provider UID와 내부 UserId를 분리한다. 인증 제공자는 “이 사람이 누구인가”를 담당하고, 내부 User는 Juple 데이터의 소유자다. 서버가 모든 사용자별 데이터 격리를 강제하며, 클라이언트 입력만으로 소유권을 결정하지 않는다.

Firebase는 Backend, Auth, Database, Storage로 사용하지 않는다. Android Push 연결을 위한 FCM 용도로만 사용한다.

## Push 알림 전송

Backend는 Azure Notification Hubs를 사용하지 않기로 결정했다(Notification Hubs data-plane SDK가 SAS Access Policy만 지원해 Managed Identity 기반 인증과 맞지 않고, FCM/APNs 대비 이중 계층이 되는 운영 복잡도가 이 프로젝트 규모에 비해 크다는 판단). 대신:

- Android: FCM v1에 Firebase Admin SDK로 직접 전송한다(legacy server key 아님).
- iOS: APNs에 직접 전송할 계획이다(아직 구현되지 않음).

Push 전송 서버 credential(Firebase 서비스 계정 JSON)은 Mobile의 `google-services.json`(client-side 설정, 비밀 아님)과 완전히 별개이며, Backend 설정(`Firebase:ServiceAccountKeyJson`)을 통해 local user-secrets 또는 Azure Container Apps secret으로만 주입한다 - 소스/appsettings에 두지 않는다.

Push는 transactional outbox + Service Bus 방식이다(Round 33).

- **API**: 알림을 일으키는 변경과 같은 SQL transaction 안에서 `notifications.NotificationEvents`에 **이벤트 1행**만 기록한다(수신자 수와 무관한 상수 비용 - 수신자 계산·`Notifications` 행 생성·FCM 호출은 API에서 하지 않는다). commit 후에는 이벤트 id를 프로세스 내부의 bounded channel에 넣고 바로 반환한다. Service Bus `notification-events` 큐로의 전송은 background publisher가 하므로 요청 경로에 네트워크 호출이 없다. channel이 가득 차거나 전송이 실패해도 이벤트는 SQL에 남는다(Azure SQL이 기록의 원본, Service Bus는 깨우는 통로일 뿐).
- **Notification worker**(`ca-juple-notify-worker-{env}`, 같은 이미지 + `--run-notification-worker`): 이벤트를 받아 수신자를 keyset paging으로 페이지 단위 materialize하고(페이지마다 고정된 수의 query, 이벤트 lease + 결정적 DedupKey로 중복 메시지·재시도에도 중복 알림 없음), 결과를 `push-deliveries` 큐에 배치로 넘겨 bounded 병렬로 FCM 전송한다. KEDA가 큐 길이로 scale하며 `minReplicas`가 지연/비용 조절점이다(Dev 0, Production 1 권장).
- **push-dispatch Job**(`caj-juple-push-dispatch-{env}`, 1분 주기): 이제 복구용이다 - 신호를 잃은 이벤트, lease가 만료된 이벤트, 유예 시간이 지나도 발송되지 않은 알림을 같은 processor로 처리한다. Service Bus 없이도 전부 전달할 수 있다.
- **재시도**: 일시적 실패는 capped exponential back-off(`NextAttemptAtUtc`)로 횟수 제한 없이 재시도한다. 오래 실패하면 `RequiresAttention` 표시만 붙고, 구조적으로 불가능한 이벤트만 `FailedPermanent`로 끝난다. Service Bus DLQ로 간 신호는 SQL 이벤트를 무효화하지 않는다.
- 전송은 (알림, 기기)별 claim으로 정상 경로에서 중복 발송하지 않지만, provider가 수락한 직후 기록 전에 프로세스가 죽으면 lease 만료 후 한 번 더 보낼 수 있다(at-least-once - exactly-once는 보장하지 않는다).

Firebase credential은 worker와 이 Job에만 있다. 친구 신청/공유 초대는 tray 알림, 초대 응답/내용 변경은 열려 있는 화면만 새로 고치는 data-only 메시지다(`infra/azure/README.md`의 "Social Push" 참고).

## Azure 구성 방향

예정 구성은 다음과 같다.

- Azure Container Apps
- Azure SQL Database
- Azure Blob Storage
- Azure Service Bus
- Microsoft Entra External ID
- Azure Key Vault
- Application Insights
- OpenTelemetry
- Azure Container Registry

환경은 Development, Staging, Production을 고려한다. Infrastructure as Code 도구는 Bicep으로 결정되었고, Development 환경의 Foundation/App 두 단계(`infra/azure/`)가 이미 배포되어 있다(`rg-juple-dev`: Managed Identity, ACR, Storage Account, Azure SQL, Log Analytics, Container Apps Environment, Container App `ca-juple-api-dev`). Staging/Production은 여전히 고려 중이며 아직 리소스를 만들지 않았다.

## 운영 원칙

- Production secret은 소스 코드에 저장하지 않고 Key Vault 등 안전한 시스템을 사용한다.
- Structured Logging, Application Insights, OpenTelemetry, Error tracking을 고려한다.
- 시간은 UTC로 저장하고 표시 시 사용자 TimeZone을 적용한다.
- 금액은 숫자만 저장하지 않고 `Amount`와 `CurrencyCode`를 함께 관리한다.
- DB schema 변경은 EF Core Migration으로 추적한다.
- API는 versioning 가능한 계약을 고려한다.

## 알려진 아키텍처 후속 과제

### 컬렉션 확정 콘텐츠의 수명 독립 (Collection confirmed-content lifetime independence)

- 현재(Round 36): 멤버가 나가거나(self-leave) Owner가 멤버를 제거해도 그 멤버가 추가한 확정 링크(직접 추가, 승인된 제안)는 컬렉션에 남는다. 제거되는 것은 멤버십, 아직 대기 중인 제안과 그에 대한 Owner 알림, 그 멤버의 반응, 즐겨찾기 표시다. 댓글은 남는다.
- 남은 문제: 컬렉션 링크(`collections.CollectionItems`)는 기여자 개인의 Item을 참조한다. 그래서 전 멤버가 나중에 자기 Item을 삭제하면 그 링크도 컬렉션에서 사라진다 - 확정 콘텐츠의 수명이 여전히 기여자 개인 Item의 수명에 묶여 있다.
- 향후 제품 결정이 필요하다: 컬렉션 콘텐츠가 기여자 Item과 독립된 자체 durable entry/snapshot을 가져야 하는지. 이번 단계에서는 schema/model을 바꾸지 않는다.

## Home and Archive Collection lock context

An `Item` belongs to one user, while `CollectionItem` is a many-to-many membership carrying `AddedByUserId`. A personal Home or Archive card uses only active Collection memberships added by that Item's owner and still accessible to that user. If several such memberships exist, a gated Collection takes precedence, followed by newest `AddedAtUtc` and membership ID. A membership added by someone else does not mask the personal card.

The history query chooses that context in SQL. For a gated context it returns the Item ID, saved time, Collection ID, and gate kind, with URL empty and title, memo, preview, and image fields null. Search excludes those gated Items so a hidden title, URL, or memo cannot be discovered by a query. A gated card is opened IN its Collection context: `GET /api/v1/items/{id}?collectionId=` (and `GET /api/v1/items/{id}/images?collectionId=`) first applies that Collection's current content gate - the lock for its Owner (no Owner bypass), the share password for a member - with the `X-Juple-Collection-Unlock` grant for that same Collection, and requires the Item to be the caller's own and in that Collection; only then is anything read. The context is per Collection, never a global Item lock: the same Item in another, unlocked Collection, and a read without a context, are unaffected. On tap, the mobile client reads current Collection access first; while the Collection is locked every open asks for the password, and the grant it returns is handed to the Item Details popup in memory for that one opening only (never stored, never reused from a Collection Details visit), so closing the popup and tapping the card again asks again.

## Subscription foundation (R39-A)

Product direction: one monthly auto-renewing subscription (US base target USD 0.99/month), purchasable through BOTH Google Play and the App Store, after a Juple-controlled 30-day free trial. Localized prices always come from each store's product metadata - never hard-coded in the app or served by the backend. Web has no billing in the first release; it may later consume the same account entitlement. R39-A is the foundation only: no store SDK, no Play/App Store product, no purchase UI, and **enforcement is behaviorally OFF**.

- **Account-centric entitlement.** Access belongs to the Juple account (`UserId`), never to a device or store. `IEntitlementService` answers "what access does this account have" and is deliberately separate from `ICurrentJupleUserAccessor` ("who is this"). Public states: `trial`, `active`, `gracePeriod`, `expired` (internal reason: none / cancelled / billingIssue / refunded - copy only, never access). The backend decides access from **server time**; the store receipt is only proof of payment, and the app only presents state.
- **Program switch.** `Billing:ProgramEnabled` (default **false**) and `Billing:ProgramStartAtUtc`. While disabled: nothing is blocked or frozen, no trial is started or consumed (shipping this code starts nobody's clock), and bootstrap reports `programEnabled:false`, `status:null`, `canWrite:true` - explicitly not "active". Enabling requires `ProgramStartAtUtc` and the ledger HMAC key (`Billing:TrialIdentityHashKey`, Base64 >= 32 bytes, user-secrets locally / Container Apps secret or Key Vault reference when deployed); an invalid combination stops the API at startup. `Billing:TrialDurationDays` must equal 30 (fixed policy, not a tunable). There is no development entitlement override.
- **Trial.** Exactly 30 x 24 hours of UTC time. Account created before `ProgramStartAtUtc`: `ProgramStart .. ProgramStart + 30d`. Created at/after it: `CreatedAt .. CreatedAt + 30d`. Stored as `users.Users.TrialStartedAtUtc/TrialEndsAtUtc` (nullable, never backfilled by a migration).
- **Trial ledger (anti-reset).** Account deletion does not delete the Entra identity, so signing in again creates a new `UserId`. `billing.TrialLedger` remembers `HMAC-SHA256(key, "juple-trial-v1|tenantId|objectId")` plus the trial window - no email, name, Juple ID, raw ids or tokens, and **no FK to Users** so it survives deletion. A re-created account is given the ORIGINAL window, never a fresh 30 days. Settlement is atomic and idempotent (unique `UX_TrialLedger_IdentityHash`; concurrent first calls converge on one row and one window). **Release blocker: the ledger's retention period and its privacy-policy disclosure must be decided and reviewed before the subscription program launches in Production.** A keyed hash is not asserted to be anonymous.
- **Expired = read-only (planned enforcement).** Existing personal data is never deleted or hidden; reads, support, account deletion, billing and sign-in stay available; content mutations will require a subscription. `Entitlement.AccessFrozenAtUtc` is the stable instant live access ended (the trial end; later a verified paid end) - never "now" - and is null while live. `RequireWriteAccess` (403, code `subscriptionRequired`) is the reusable write gate; `AllowWhenSubscriptionExpired` marks the escape hatches (account, support, bootstrap/session, push devices; billing controllers later). It is applied to **no** endpoint yet and is a no-op while the program is disabled.
- **Shared Collections (planned).** Entitlement is evaluated for the ACTOR/VIEWER, not the owner: an expired owner does not freeze active members, and an active owner does not unfreeze an expired member. An expired viewer keeps content that was already visible in the Collection when their access ended (`AccessFrozenAtUtc`) and does not see what others add afterwards; resubscribing restores it immediately with no catch-up. Public/anonymous reads are never gated; anonymous writes into an expired owner's Collection will be blocked (on the owner's write entitlement - unrelated to this read rule).
- **`CollectionItem.VisibleSinceUtc`.** `AddedAtUtc` keeps its existing meaning - the browsing/history time (date sections, ordering, "added" dates), which a move or merge carries over - and nothing derives from the new column. `VisibleSinceUtc` is the instant THIS membership became visible/confirmed content of THIS Collection, an internal access-control timestamp that no UI shows: a direct add or a new save = the creation time; an approved proposal = the **approval** time (not when it was proposed); a copy-in, a move or merge target and a restored (undone) membership = the time of that operation, never the source's. Editing a link never changes it. It is NOT NULL with no database default - every creation path sets it explicitly (`CollectionItem.CreateNew`, or the constructor, which requires it) - and the migration backfilled existing rows from `AddedAtUtc` (the best historical approximation; never the migration time). A viewer frozen at `AccessFrozenAtUtc` sees a link while `VisibleSinceUtc <= AccessFrozenAtUtc`; content exactly at the boundary counts as visible. The condition is written once, in `SharedContentFreeze.WhereVisibleThrough`, and is **not wired into any live query yet**. R39-D must apply this same rule to the Collection item count and list, search, detail/open authorization, List/Grid/Image, paging results and collaboration-notification eligibility, and should add an index only together with that query plan. **Three separate things, not to be confused:** (1) the *application invariant* - every current code path assigns `VisibleSinceUtc` explicitly from its own operation time, and the EF model has no default for it (so nothing can come to rely on a database-generated value; the constructor requires it); (2) *historic rows* - backfilled from `AddedAtUtc`; (3) a *temporary database compatibility default*, `DF_CollectionItems_VisibleSinceUtc_RollingCompat` = `TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00')`, which exists only so the PREVIOUS API revision - which does not know the column and omits it from its INSERTs - keeps working while old and new revisions coexist; its fallback is "the instant the row was inserted", which is acceptable for that window. The default is a deployment artifact added by raw migration SQL (not in the EF model or snapshot), is never the canonical behavior, and never overrides an explicit value. **Rolling-safe sequence:** (a) apply the migration - the column is added nullable, historic rows backfilled from `AddedAtUtc`, made NOT NULL, and only then given the named default (the default must come last, or it would stamp every historic row with "now"); (b) old and new API revisions can coexist; (c) deploy the new API revision; (d) shift traffic and retire the old revision; (e) in a later release, a contract migration `RemoveVisibleSinceUtcRollingCompatDefault` drops ONLY that constraint (the column stays NOT NULL) - to be created only once every environment runs R39-A-or-newer, no previous revision can receive traffic, all creation paths assign the value explicitly and no NULL rows exist. The default must not be left in place forever.
- **Legacy Free/Plus.** `UserPlan`, `Users.Plan` and the bootstrap `plan` field remain only for old installed clients. No feature branches on them and they are never the entitlement source; removal is a later contract migration.
- **Not yet built.** Google Play (R39-B) and App Store (R39-C) purchase verification and server notifications, their persistent purchase identities, Key Vault for store credentials, the subscription UI and expired-state enforcement (R39-D).
