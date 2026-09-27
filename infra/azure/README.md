# Juple Azure Infrastructure (Bicep)

Azure **Development** 환경만을 위한 IaC. Staging/Production 리소스는 아직 만들지 않는다
(`docs/architecture.md`가 이 둘을 여전히 "고려 중"으로 취급).

로컬 개발 인프라(`infra/local/`, SQL Server + Azurite Docker)와는 별개이며, 이 디렉터리는
실제 Azure 리소스만 다룬다.

## 배포 순서

Container App이 아직 존재하지 않는 이미지 태그를 참조해 Foundation 배포 자체가 막히는 구조를
피하기 위해 두 단계로 분리되어 있다.

1. **Foundation** (`foundation/`) — Resource Group, User Assigned Managed Identity, Azure
   Container Registry(Basic), Storage Account(+ `item-images` Blob container), Azure SQL 논리
   서버/Database, Log Analytics Workspace, Container Apps Environment, RBAC(AcrPull, Storage Blob
   Data Contributor)를 생성한다. `Microsoft.App/containerApps`는 이 단계에서 전혀 만들지 않는다
   — Foundation은 이미지 존재 여부와 완전히 무관하게 성공해야 한다.

   Storage Blob Data Contributor 하나만 부여한다 — 이 역할의 Actions에 이미
   `Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action`이 포함되어
   있어(`az role definition list`로 확인), 동일 Storage Account scope에 Storage Blob Delegator를
   별도로 추가하는 것은 중복이다. 다만 향후 이 Managed Identity의 Data Contributor 권한을 계정
   전체가 아니라 특정 container 단위로 좁히면서도 user delegation key 발급은 계정 단위로 계속
   필요해지는 경우에는 Storage Blob Delegator가 다시 필요할 수 있다.

2. **이미지 빌드 & push** — `backend/src/Juple.Api/Dockerfile`로 빌드한 이미지를 Foundation이
   만든 ACR에 push한다.

3. **App** (`app/`) — Foundation의 output(ACR login server, Container Apps Environment 리소스
   ID, Managed Identity 리소스 ID 등)을 parameter로 받아 실제 Container App을 배포한다.

## 현재 배포 상태

Azure Dev 환경(`rg-juple-dev`)에는 Foundation, App, Push dispatch Job 세 단계가 **모두 이미
배포되어 있다**: User Assigned Managed Identity, Azure Container Registry, Storage Account,
Azure SQL 논리 서버/Database, Log Analytics Workspace, Container Apps Environment, Container App
`ca-juple-api-dev`(scale-to-zero, `minReplicas=0`, revision healthy/traffic 100%), 그리고
Container Apps Job `caj-juple-push-dispatch-dev`까지 실제로 존재하고 "Succeeded" 상태다.
`publicCollectionCursorEncryptionKey`/`sql-connection-string`/Push Job의 `firebase-credential`
secret도 모두 이미 주입되어 있다. 실기기(S19B00263) 기준 Push 실전송/tap navigation/Log Purchase
lifecycle까지 end-to-end 검증 완료(2026-09-07). SQL 방화벽은 임시 규칙 없이 `AllowAzureServices`만
남아 있다.

**account deletion 기능 추가(commit `a314252`)로 위 상태 대비 2개 migration이 새로 미적용이고,
Blob cleanup용 Container Apps Job(`caj-juple-blob-cleanup-dev`)이 아직 배포되지 않았다** - 아래
"Blob cleanup scheduled Job" 섹션 참고. 이 Job이 배포되기 전까지 account deletion은 production
release 대상이 될 수 없다(hard release blocker).

Web Container App(`ca-juple-web-dev`)도 이미 배포되어 있고, custom domain `dev.juple.co.kr` +
managed certificate가 bound되어 DNS/TLS 정상, Android App Links Dev E2E PASS 상태다 - 아래 "Web
custom domain" 섹션 참고(이 binding이 Bicep 재배포로 유실되던 문제와 그 수정 내용).

아래 명령 예시는 재배포/업데이트 시 참고용이며, 이미 배포된 부분(Foundation/App/Push Job)은
"아직 실행하지 않음"이 아니라 향후 재배포 시 참고용이다 — 실제 값/시크릿은 예시에 포함하지 않는다.

## API revision rollback 주의 - Collection Viewer(보기 전용) 역할 도입 이후

Dev에는 `ca-juple-api-dev--0000037`(image `juple-api:viewer-r4-devtest-20260926-2237`)부터
Collection 멤버 역할 `Viewer`(보기 전용 공유)가 있다. 역할은 `collections.CollectionCollaborators.Role`
/ `collections.CollectionInvitations.Role`에 문자열로 저장되며, 이 기능에는 schema 변경(migration)이
없다 - 그래서 DB만 보고는 "되돌려도 안전한지" 알 수 없다.

- **Viewer membership 또는 pending Viewer invitation이 한 건이라도 생긴 뒤에는
  `--0000036` 또는 그 이전의 role-unaware revision으로 rollback하지 않는다.** 이전 코드는 collaborator
  row를 역할과 무관하게 Contributor로 취급하므로, 그 revision에서는 Viewer가 링크를 추가할 수 있게
  되고(권한 상승), pending Viewer invitation을 수락한 사용자도 공동작업자처럼 동작하며, public share와의 배타
  규칙도 Viewer를 Contributor로 계산한다.
- 이전 revision을 삭제할 필요는 없지만, 정상적인 rollback 대상으로 취급하지 않는다.
- rollback이 꼭 필요하면 다음 중 하나로만 한다:
  1. 먼저 Viewer 데이터를 정리한다 - Viewer membership 제거(Owner의 "내보내기"와 같은 정리:
     해당 사용자의 그 Collection `CollectionFavorites` 행 포함)와 pending Viewer invitation revoke.
     정리 결과(`Role = 'Viewer'`인 행이 0건)를 read-only로 확인한 뒤에만 이전 revision으로 돌린다.
  2. 또는 역할을 구분하는(role-aware) 호환 revision - `--0000037` 이후 코드 기반 hotfix - 을 사용한다.

## Collection 잠금 비밀번호: 사용자당 1개 (최종 구조, Round 10)

경과: Round 5(`--0000038`)는 Owner당 공통 비밀번호, Round 6/7(`--0000039`/`--0000040`)은 Collection별 비밀번호였다.
Round 10에서 **사용자당 잠금 비밀번호 1개**로 최종 확정했다(schema 변경 없음 - migration 없음).

- source of truth는 `collections.UserCollectionLockSettings.PasswordHash`(PBKDF2 versioned hash)다. 이 row가 있으면
  그 Owner의 **모든** `IsLocked=1` Collection은 무조건 이 hash로 검증한다(`CollectionLockPasswordSource`) - 멤버
  (읽기/작성), public locked link, Owner 자신 모두 같다. Owner도 bypass 없음.
- Collection은 잠금 상태(`IsLocked`/`LockVersion`)만 가진다. 잠금 설정(`PUT /collections/{id}/lock`)은 비밀번호를
  받지 않고, Owner에게 row가 없으면 `409 collectionLockPasswordNotConfigured`. 비밀번호를 보내는 이전 앱은
  `409 collectionLockUsesAccountPassword`(다른 비밀번호로 잠기는 일 방지). 해제는 그 비밀번호 검증 후.
- 비밀번호 관리는 설정 > 컬렉션 잠금에서만: `GET/PUT /api/v1/users/me/collection-lock`(상태/변경 - 현재 비밀번호,
  persisted 실패 throttle 5회/15분), `POST /api/v1/users/me/collection-lock/reset`(최초 설정과 "비밀번호를
  잊으셨나요?" 공통 - 현재 비밀번호 없음, **최근 재로그인 필수**). 둘 다 identity당 5회/15분 rate limit
  (`collection-lock-password`). 원문 보기/찾기 기능은 없다(서버는 hash만, 기기는 아무것도 저장하지 않음).
- set/change/reset은 한 transaction에서 row 생성/교체 + `PasswordChangedAtUtc` + 그 Owner의 모든 잠긴 Collection
  `LockVersion++`(in-app·public grant 전부 무효) + Owner 자신의 unlock 실패 counter 초기화를 한다.
- 전환: row가 없는 Owner는 기존 Collection별 비밀번호(`Collections.LockPasswordHash`)로 계속 열린다(잠금 상실 없음).
  row를 만드는 순간(재로그인 필수) 모든 잠긴 Collection이 공통 비밀번호로 넘어가고 이전 개별 비밀번호는 더 이상
  검증하지 않는다. `LockPasswordHash`/`LockPasswordChangedAtUtc` column은 rolling/rollback 안전을 위해 **drop하지
  않는다**(안정화 후 별도 cleanup migration). 새 잠금은 per-Collection hash를 만들지 않는다.
- DEV의 Round 5 row 1건은 삭제/재생성하지 않고 그대로 정식 row로 쓴다. 그 사용자가 비밀번호를 모르면 "비밀번호를
  잊으셨나요?" → 실제 Email 재로그인 → reset으로 새로 설정한다(DEV E2E 핵심 시나리오). **주의**: 배포 순간
  그 사용자가 Round 6/7에서 개별 비밀번호로 바꾼 Collection도 Round 5 비밀번호로 열리게 되며, 이 전환 자체는
  `LockVersion`을 올리지 않는다(이미 발급된 grant는 원래 만료 시각까지 유효 - 같은 Owner 본인/멤버의 짧은 grant).
- Mobile은 Collection 비밀번호를 어디에도 저장하지 않는다. Round 7 Dogfood가 Keychain/Keystore에 남긴 항목
  (`com.juple.app.collection-lock.v1.*`)은 앱 시작/로그아웃 시 읽지 않고 삭제만 한다. `react-native-keychain`은
  로그인 세션 저장용으로 그대로 쓴다.
- Picker(ItemDetails/NewLinkReview): 잠긴 Collection마다 비밀번호(= Owner 공통 비밀번호)를 검증하고 **Collection별
  grant**를 따로 받는다. 입력한 비밀번호를 picker 세션에 들고 있다가 재사용하지 않는다(평문을 메모리에 유지하지
  않기 위해) - 같은 Owner의 잠긴 Collection 여러 개를 고르면 각각 입력한다. picker를 닫으면 grant는 폐기된다.
- 계정 삭제 시 row도 삭제된다.

Rollback 호환성:

- 공통 비밀번호 set/change/reset 또는 새 잠금이 한 번이라도 일어난 뒤에는 Round 6/7 revision(`--0000039`,
  `--0000040`, `--0000041`)으로의 **정상 rollback 금지**. 그 revision은 Collection 자체 hash가 row 생성 이후에
  바뀌었으면 개별 비밀번호로 검증하므로(비밀번호 semantics가 다르다), 사용자가 설정한 공통 비밀번호로 열리지 않는
  Collection이 생길 수 있다. 필요하면 공통 비밀번호를 인식하는 hotfix revision을 쓴다. 이전 revision 삭제 금지.
  **DEV 현재 상태**: 2026-09-27 `ca-juple-api-dev--0000042`(image `commonlock-r10-devtest-20260927-2017`)에서 E2E로
  공통 비밀번호 reset/change와 새 잠금이 이미 성공했다 - DEV는 이 금지 조건에 해당한다.
- `--0000037` 이하(공통 비밀번호를 모르는 revision)로의 rollback 금지 조건은 그대로다(row가 1건 이상).
  확인: `SELECT COUNT(*) FROM collections.UserCollectionLockSettings`(read-only).
- 이전 APK(Round 6/7)의 잠금 설정은 `409 collectionLockUsesAccountPassword`, 비밀번호 변경은 동작하지 않는다.
  API와 새 APK를 함께 배포한다.

### 모든 사용자 공유: 읽기 / 작성 (Round 7, migration `AddPublicShareWritePermission`)

- `CollectionShares.Permission`(`varchar(10) NOT NULL DEFAULT 'Read'`)과 `CollectionItems.AddedViaPublicShare`
  (`bit NOT NULL DEFAULT 0`)만 추가하는 additive migration이다(상수 default - 기존 row 변경 없음). 이전 revision은 두
  column을 모르고 INSERT해도 default가 들어가므로 migration 적용 직후에도 정상 동작한다.
- `작성` 링크: **Juple에 로그인한 사용자만** 자기 Item을 추가할 수 있다(`PUT /api/v1/public-shares/{publicId}/items/{itemId}`,
  `JupleUser` 인증 필수 → anonymous는 401, identity당 30회/10분 rate limit). 익명 공개 API(`api/v1/public/*`)에는
  쓰기 경로가 없다. 추가한 사람은 `AddedByUserId`로 기록되고, membership/관리 권한은 생기지 않는다. 잠긴 Collection은
  그 링크의 unlock grant가 있어야 추가할 수 있다. Owner는 기존 링크 제거로 삭제할 수 있다.
- 공개 페이지는 Owner Item + `AddedViaPublicShare` Item만, public-safe field(title/url/자동 preview)만 보여준다.
  메모·업로드 사진·추가자 식별자는 노출되지 않는다. 특정 사용자 `작성`(Contributor)과 공개 링크의 배타 규칙은 그대로다.
- Rollback: 이 revision 이전으로 돌리면 `Permission='Write'` 링크는 읽기 전용으로 동작하고 public writer 링크는 공개
  페이지에서 빠진다(데이터 손실 없음, 안전한 방향). abuse 대응(신고/차단/링크별 추가 한도)은 아직 없다 - Owner의 링크 제거와
  `공유 중지`가 현재 수단이다.

### 잠금 비밀번호 재설정: 최근 재로그인(auth_time) 서버 검증

DEV Entra 변경(2026-09-27): External ID tenant `d2e79a05-…`의 **Juple API** app registration(appId `14bcc3b7-…`)에
access token optional claim `auth_time`을 추가했다(이전: optionalClaims 없음). **유지한다** - reset이 이 claim에
의존한다. Mobile app registration과 Production Entra는 변경하지 않았다. Production tenant를 만들 때 같은 optional
claim을 추가하고 아래 실측을 다시 해야 한다(launch requirement).

DEV 실측(2026-09-27, 실제 기기, Email/local 계정, 임시 observer `--0000041`로 서버 시각 기준 경과 초만 기록 -
토큰 원문은 어디에도 기록하지 않음):

| 단계 | auth_time | auth age | iat age |
| --- | --- | --- | --- |
| A. 기존 세션 access token | 있음 | 약 2,070,715초 | 약 308초 |
| B. refresh 후 | 있음 | 약 2,070,719초 (갱신되지 않음) | 약 301초 |
| C. `prompt=login` + `max_age=0` (Email 비밀번호 실제 재입력) | 있음 | 약 5초 | - |
| D. C 이후 다시 refresh | 있음 | 약 22초 (C 시각 유지) | - |

결론(Email/local): `auth_time`은 사용 가능하고, refresh/silent 갱신은 최근 재인증이 아니며, 실제 `prompt=login`
비밀번호 입력만 새 인증 시각이 된다 - PASS. fresh token의 `iat`가 수 분 전처럼 보이는 issuer 동작이 관찰되어
`iat`는 recent-auth 판단에 쓰지 않는다. 측정용 observer 코드와 Mobile 재인증 테스트 화면은 제거했고, DEV
Container App의 `Diagnostics__RecentAuthObserver__Enabled` env var도 `--0000042` 배포 때 제거했다.

서버 규칙(`RecentAuthentication`, `AuthenticationTimeClaim`): 서명 검증된 access token의 `auth_time`(Unix 초)만
사용한다. 없음/형식 오류 → 거절, server UTC now 기준 5분 초과 → 거절, 60초를 넘는 미래 값 → 거절(clock skew 허용
60초). client가 보내는 flag/시각, `iat`, refresh 발급 시각은 절대 쓰지 않는다. 거절은
`403 recentAuthenticationRequired` - Mobile은 "본인 확인 시간이 만료되었습니다. 다시 로그인해 주세요."를 보여준다.

Mobile 흐름: "비밀번호를 잊으셨나요?"(또는 최초 설정) → 안내 → `authorize({ additionalParameters: { prompt: 'login',
max_age: '0' } })` → ID token의 tid+oid(없으면 iss+sub)가 현재 세션과 같을 때만 새 토큰으로 세션 교체(다르면 교체
없이 중단) → 새 비밀번호 2회 → `POST .../reset` → 로컬 unlock grant 전부 폐기. 최초 설정도 항상 재로그인을 요구한다
(기존 개별 비밀번호를 한꺼번에 대체하는 takeover이므로 reset과 같은 규칙 하나로 통일).

**Google / Apple (launch requirement)**: 현재 DEV user flow(`JupleSignUpSignIn`)에는 Email with password만 연결되어
있어 실측하지 못했다(NOT TESTED). provider를 활성화하기 **전에** provider별로 위 A~D(일반 auth_time, refresh 유지,
`prompt=login` 후 갱신 - 특히 social IdP의 silent SSO가 `prompt=login`을 우회하지 않는지)를 같은 방식으로 다시
실측해야 한다. 실패하면 그 provider 계정에는 reset을 허용하지 않는 분기(예: `idp` claim 기준)가 필요하다 - 지금은
provider가 local 하나뿐이라 분기를 만들지 않았다.

보안 TODO(aggregate throttling): unlock 실패 throttle은 Collection별 bucket이다(로그인 사용자 5회/15분, public link는
client별 5회 + link별 100회 ceiling). 이제 한 Owner의 잠긴 Collection이 모두 같은 비밀번호이므로, 여러 Collection에
접근할 수 있는 사람은 Collection 수만큼 추측 기회를 얻는다(멤버십 또는 public locked link가 여럿 필요). owner-level
aggregate throttle은 anonymous 시도가 Owner를 잠그는 DoS가 되지 않도록 bucket을 분리해서 설계 검토한다.

**Production blocker (Collection 잠금)** - DEV E2E 통과와 무관하게 Production 전에 필요:

1. Google 로그인 활성화 전 `auth_time` / refresh 유지 / `prompt=login` 갱신 실측(위 A~D).
2. Apple 로그인 활성화 전 같은 실측.
3. Owner 단위 aggregate 비밀번호 시도 throttle - 공통 비밀번호가 여러 Collection에 쓰이므로 Collection별 5회
   제한만으로는 추측 기회가 Collection 수만큼 늘어난다.
4. 잠금 비밀번호 입력 화면(잠금 해제, 설정 > 컬렉션 잠금) screenshot/화면 녹화 보호(Android `FLAG_SECURE`, iOS
   대응) 검토.

## Social Push와 공유 권한 규칙 (Round 12 - 아직 DEV 미배포)

### 구조

- **Outbox**: API는 이벤트를 `notifications.Notifications`에 기록만 한다(Type 1 친구 신청, 2 Collection 초대,
  3 초대 수락/거절 → Owner, 4 공유 Collection 링크 추가/삭제 → 다른 멤버). `DedupKey`(unique)로 같은 이벤트는
  한 번만 들어가고, 내용 변경은 수신자·Collection·1분 단위로 묶인다. 기록 실패는 사용자 동작을 실패시키지 않는다.
- **전송**: `caj-juple-push-dispatch-{env}` Job(`--run-push-dispatch`)이 미전송 행을 FCM v1으로 보낸다
  (`DispatchPendingPushNotificationsService`). 전송 직전 대상이 아직 유효한지 다시 확인한다(요청/초대가 이미
  응답·취소·만료됐거나 멤버가 아니면 보내지 않음). tray 알림은 6시간, data-only는 10분이 지나면 보내지 않고
  만료 처리한다. (notification, device)마다 한 번만 보내는 것은 `NotificationDeliveryStore.TryClaimAsync`가
  보장하므로 Job 실행이 겹쳐도 안전하다. 영구적으로 죽은 token은 등록을 비활성화한다.
- **credential**: Firebase 서비스 계정은 여전히 **Job에만** 있다(API Container App에 넣지 않는다).
- **문구**: 서버가 device 등록 locale(앱 언어)로 17개 언어 중 하나를 고른다. 발신자 표시 이름(없으면 Juple ID)과
  Collection 이름만 들어가고, 친구 private 메모·링크·토큰은 절대 들어가지 않는다.
- **Launcher badge**: tray 알림에 수신자의 미처리 친구 신청 + Collection 초대 수를 FCM
  `AndroidNotification.NotificationCount`로 싣는다. 숫자 표시는 launcher마다 다르다(점만 찍는 기기도 많다).
  앱 안의 badge(내 페이지 › 친구, Collections › 공유 컬렉션)가 기준이다. iOS APNs는 아직 구현되지 않았다.
- **Mobile**: 알림 권한은 친구/공유 화면을 처음 열 때 한 번만 묻는다. 거절해도 앱 안의 badge와 목록은 포커스,
  앱 복귀(15초 이상 지났을 때), 포그라운드 Push로 갱신된다. 짧은 주기 polling은 하지 않는다.

### 배포 시 필요한 것 (다음 DEV rollout)

1. Migration `AddSocialPushNotifications` 적용: nullable column 5개(`ActorUserId`, `CollectionId`, `SubjectId`,
   `DedupKey`, `DispatchedAtUtc`), filtered index 3개, `CK_Notifications_Type_Valid`를 `IN (0,1,2,3,4)`로 확장.
   additive라 이전 revision은 그대로 동작한다. 기존 행은 `DedupKey`가 NULL이라 dispatch 대상이 아니다.
2. API revision 배포. 이 시점부터 outbox에 행이 쌓인다(Job이 아직 예전 이미지면 보내지 않고 쌓이기만 하고,
   6시간/10분이 지나면 새 Job이 만료 처리한다).
3. `caj-juple-push-dispatch-dev`를 같은 이미지로 update하고 **cron을 `* * * * *`로 변경**(현재 live는 매시
   정각 + 오래된 이미지 `b1f5fba`의 no-op). `job/main.bicep` 기본값도 매분, `replicaTimeout` 300초로 바꿨다.
   Job의 Firebase secret은 그대로 둔다.
4. Metadata/blob-cleanup Job은 기존 규칙대로 같은 이미지로 맞춘다.

### 모든 사용자 공유 중 개별 권한 규칙 (변경)

- 이전: 공개 링크와 `링크 추가`(Contributor) 개별 사용자는 공존 불가.
- 이후: 공개 링크가 켜져 있으면 **모든 개별 사용자와 대기 중 초대의 권한이 공개 링크 권한과 같아야 한다**
  (`보기만` → Viewer, `링크 추가` → Contributor). 초대·권한 변경·수락은 서버가 거절하고(409
  `publicShareActive`), 공개 링크 켜기/권한 변경은 다른 권한의 사용자가 있으면 거절한다(409
  `publicSharePermissionMismatch`). 자동으로 누구의 권한도 바꾸지 않는다. 공개 페이지에는 여전히 Owner Item과
  공개 링크로 추가된 Item만 보인다(멤버가 추가한 링크는 공개되지 않는다).
- Rollback: 새 규칙에서 만든 상태(`링크 추가` 공개 링크 + Contributor 멤버)는 이전 revision에서도 데이터상
  유효하다(이전 코드는 전환 시점에만 검사한다). 이전 revision으로 돌리면 그 조합을 새로 만들 수 없게 될 뿐이다.

### 초대 rate limit

- 초대(`POST /collections/{id}/invitations`)는 Juple ID 조회와 같은 bucket(identity당 10분 20회)을 쓰던 것을
  별도 `collection-invite` bucket(identity당 10분 30회)으로 분리했다. 조회는 그대로 10분 20회. Mobile의 10명
  batch 제한은 이 공유 bucket 때문이었고, 이제 제한 없이 3건씩 순차 전송하며 사람마다 결과를 남긴다(한도를 넘으면
  그 사람만 "잠시 후 다시" 오류).

## 명령 예시 (참고용 — 실제 값/시크릿은 예시에 포함하지 않음)

```powershell
# 1. Foundation (subscription scope)
az deployment sub create `
  --location koreacentral `
  --template-file infra/azure/foundation/main.bicep `
  --parameters environmentName=dev sqlAdministratorLoginPassword=$env:SQL_ADMIN_PASSWORD

# Foundation output을 이후 단계에서 재사용
$foundation = az deployment sub show --name <deployment-name> --query properties.outputs -o json | ConvertFrom-Json

# 2. 이미지 빌드 & push (Job도 동일 이미지를 재사용하므로 한 번만 하면 된다)
az acr login --name $foundation.acrName.value
docker build -f backend/src/Juple.Api/Dockerfile -t "$($foundation.acrLoginServer.value)/juple-api:<tag>" backend/
docker push "$($foundation.acrLoginServer.value)/juple-api:<tag>"

# 3. App (resource group scope) - app/main.bicep 자체는 environment-neutral하다: entraInstance/
# entraTenantId/entraClientId에 Dev 전용 기본값을 두지 않는다(과거엔 뒀었는데, Production 배포에서
# 이 셋을 override하는 걸 잊으면 Dev Entra tenant를 그대로 인증에 써버리는 위험이 있어 제거했다 -
# customDomainName/managedCertificateName도 Web과 동일한 이유로 Dev 전용 기본값이 없다). Dev의
# 실제 값은 `infra/azure/app/dev.bicepparam`에 고정되어 있다 - Web(위 6번)과 같은 이유로 non-secret
# live 값(acrLoginServer 등)은 readEnvironmentVariable(...)로 읽고, secret 3개
# (sqlConnectionString/publicCollectionCursorEncryptionKey/collectionUnlockGrantEncryptionKey)도 .bicepparam 사용 시
# `--parameters`를 한 번만 허용하는 CLI 제약 때문에 같은 방식으로 읽는다 - 값 자체는 여전히 파일에
# 커밋되지 않고, 배포자의 shell에 설정한 환경변수에서만 읽힌다.
$env:JUPLE_APP_ACR_LOGIN_SERVER = $foundation.acrLoginServer.value
$env:JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID = $foundation.containerAppsEnvironmentId.value
$env:JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID = $foundation.managedIdentityResourceId.value
$env:JUPLE_APP_MANAGED_IDENTITY_CLIENT_ID = $foundation.managedIdentityClientId.value
$env:JUPLE_APP_STORAGE_BLOB_SERVICE_URI = $foundation.storageBlobServiceUri.value
$env:JUPLE_APP_IMAGE_TAG = '<tag>'
$env:JUPLE_APP_SQL_CONNECTION_STRING = $env:SQL_CONNECTION_STRING
$env:JUPLE_APP_PUBLIC_COLLECTION_CURSOR_ENCRYPTION_KEY = '<기존과 동일한 32바이트 key의 Base64 - 새로 생성하지 않는다>'
# Collection unlock grant key - cursor key와 반드시 다른 별개의 값. 이미 live인 값(secret
# collection-unlock-grant-key)을 그대로 쓴다(교체하면 발급된 grant만 무효화되고 데이터 영향은 없다).
# One-shot Job들은 이 key를 검증하기 전에 종료하므로 Job Bicep에는 넣지 않는다.
$env:JUPLE_APP_COLLECTION_UNLOCK_GRANT_ENCRYPTION_KEY = '<별도 32바이트 key의 Base64>'

az deployment group create `
  --resource-group $foundation.resourceGroupName.value `
  --parameters infra/azure/app/dev.bicepparam

# 4. Push dispatch Job (resource group scope) - App과 별개 리소스, 별개 secret 네임스페이스.
# firebaseServiceAccountKeyJson도 같은 이유로 @<file> 문법으로 전달한다 - 사용자가 이미
# repo 밖(local-only)에 저장해 둔 실제 Firebase service-account JSON 파일 경로를 그대로 가리키면 되고,
# 파일 내용을 셸 변수에 대입하거나 화면에 붙여넣는 중간 단계 자체가 없다.
az deployment group create `
  --resource-group $foundation.resourceGroupName.value `
  --template-file infra/azure/job/main.bicep `
  --parameters `
    acrLoginServer=$foundation.acrLoginServer.value `
    imageTag=<App과 동일한 tag> `
    containerAppsEnvironmentId=$foundation.containerAppsEnvironmentId.value `
    managedIdentityResourceId=$foundation.managedIdentityResourceId.value `
    sqlConnectionString=$env:SQL_CONNECTION_STRING `
    firebaseServiceAccountKeyJson=@<repo 밖 Firebase service-account JSON 파일 경로>

# 5. Blob cleanup Job (resource group scope) - Push Job과 완전히 별개 리소스/secret 네임스페이스.
# Firebase 관련 parameter가 전혀 없다 - 이 Job은 FCM/Push와 무관하다(아래 "Blob cleanup scheduled
# Job" 참고). storageBlobServiceUri/managedIdentityClientId는 App과 동일한 Foundation output이다.
az deployment group create `
  --resource-group $foundation.resourceGroupName.value `
  --template-file infra/azure/blob-cleanup-job/main.bicep `
  --parameters `
    acrLoginServer=$foundation.acrLoginServer.value `
    imageTag=<App과 동일한 tag> `
    containerAppsEnvironmentId=$foundation.containerAppsEnvironmentId.value `
    managedIdentityResourceId=$foundation.managedIdentityResourceId.value `
    managedIdentityClientId=$foundation.managedIdentityClientId.value `
    storageBlobServiceUri=$foundation.storageBlobServiceUri.value `
    sqlConnectionString=$env:SQL_CONNECTION_STRING

# 5.5 Instagram metadata retry Job (resource group scope) - Blob cleanup Job과 완전히 별개
# 리소스/secret 네임스페이스. Blob Storage/Firebase 관련 parameter가 전혀 없다 - 이 Job은 SQL
# 접근과 (API Container App과 동일한) outbound HTTPS만 필요하다(아래 "Instagram metadata retry
# scheduled Job" 참고).
az deployment group create `
  --resource-group $foundation.resourceGroupName.value `
  --template-file infra/azure/instagram-metadata-retry-job/main.bicep `
  --parameters `
    acrLoginServer=$foundation.acrLoginServer.value `
    imageTag=<App과 동일한 tag> `
    containerAppsEnvironmentId=$foundation.containerAppsEnvironmentId.value `
    managedIdentityResourceId=$foundation.managedIdentityResourceId.value `
    sqlConnectionString=$env:SQL_CONNECTION_STRING

# 6. Web (resource group scope) - apps/web (Public Collection Sharing Web Viewer), API/Job과
# 완전히 별개 리소스/이미지, secret 없음. 이미지는 환경과 무관하게 빌드된다 - build-arg가
# 전혀 없다(아래 "Web Container App" 섹션 참고) - 그래서 Dev/Staging/Prod가 같은 tag를 그대로
# 재사용할 수 있고, 환경별 차이는 전부 아래 배포 시점 parameter(Container App env)로만 갈린다.
#
# web/main.bicep 자체는 environment-neutral하다 - customDomainName/managedCertificateName에
# Dev 전용 기본값을 두지 않는다(과거엔 뒀었는데, Production 배포에서 이 둘을 override하는 걸
# 잊으면 Dev domain/certificate를 그대로 참조하는 위험이 있어 제거했다 - 아래 "Web custom domain"
# 섹션 참고). 대신 Dev의 실제 값은 `infra/azure/web/dev.bicepparam`에 고정되어 있고, Azure CLI가
# .bicepparam 사용 시 `--parameters`를 한 번만 허용해서(`az deployment group create --help`로
# 확인 - 별도 `--parameters key=value`를 덧붙여 합칠 수 없다) 나머지 필수 parameter(acrLoginServer/
# containerAppsEnvironmentId/managedIdentityResourceId/imageTag/apiBaseUrl - 전부 non-secret이지만
# subscription ID를 포함하거나 배포마다 바뀌는 live 값이라 파일에 literal로 적어둘 수 없다)는
# dev.bicepparam 안에서 `readEnvironmentVariable(...)`로 읽는다 - 아래처럼 배포자의 shell에
# 그 값을 담은 환경변수를 먼저 설정해야 한다(값 자체는 여전히 파일에 커밋되지 않는다).
az acr login --name $foundation.acrName.value
docker build -f apps/web/Dockerfile -t "$($foundation.acrLoginServer.value)/juple-web:<tag>" apps/web/
docker push "$($foundation.acrLoginServer.value)/juple-web:<tag>"

$env:JUPLE_WEB_ACR_LOGIN_SERVER = $foundation.acrLoginServer.value
$env:JUPLE_WEB_CONTAINER_APPS_ENVIRONMENT_ID = $foundation.containerAppsEnvironmentId.value
$env:JUPLE_WEB_MANAGED_IDENTITY_RESOURCE_ID = $foundation.managedIdentityResourceId.value
$env:JUPLE_WEB_IMAGE_TAG = '<tag>'
$env:JUPLE_WEB_API_BASE_URL = 'https://<3번에서 배포한 API의 containerAppFqdn>'

az deployment group create `
  --resource-group $foundation.resourceGroupName.value `
  --parameters infra/azure/web/dev.bicepparam
# googlePlayUrl/appStoreUrl/appStoreAppId/iosAppId/androidAssetlinksSha256Fingerprints는
# dev.bicepparam에 없다 - main.bicep의 기본값(빈 문자열)이 그대로 적용된다. 실값이 생기기 전까지
# fake 값을 넣지 않는다.
#
# Production(`juple.co.kr`)에 적용할 때는 같은 구조를 재사용한다 - `infra/azure/web/prod.bicepparam`을
# (Production Foundation이 실제로 생기는 시점에) 새로 만들어 customDomainName=juple.co.kr,
# managedCertificateName=<Production의 실제 Managed Certificate 이름>으로 채우고, 위와 동일하게
# 5개 환경변수 + `--parameters infra/azure/web/prod.bicepparam`으로 배포한다.

# 7. Backend에 Web의 실제 URL을 알려준다 - Dev는 이미 `app/dev.bicepparam`의 publicWebBaseUrl에
# `https://dev.juple.co.kr`이 고정 반영되어 있으므로(위 3번을 그대로 재실행하면 끝) 별도 조치가
# 필요 없다. 이 값을 나중에 바꿔야 하는 경우(도메인 이전 등)에는 해당 환경의 `<env>.bicepparam`
# 파일에서 publicWebBaseUrl 한 줄만 실제 값으로 고쳐 커밋하고, 위 3번과 동일한 명령으로
# 재배포한다 - 더 이상 이 값만 따로 --parameters로 덧붙이는 별도 배포 단계가 아니다.
```

## EF Core migration 적용

Azure SQL은 기본적으로 Azure 내부 트래픽(Container App 포함)만 허용하는 `AllowAzureServices`
방화벽 규칙만 갖고 있다. 개발자 PC에서 `dotnet ef database update`를 실행하려면, 배포 시점에
그 PC의 공인 IP에 대한 임시 방화벽 규칙을 별도로 추가하고 작업이 끝나면 제거한다. 이 IP는
고정값으로 Bicep이나 소스에 넣지 않는다:

```powershell
$myIp = (Invoke-RestMethod -Uri "https://api.ipify.org")
az sql server firewall-rule create --resource-group <rg> --server <sqlServerName> `
  --name "TemporaryDevMachine" --start-ip-address $myIp --end-ip-address $myIp
# ... 아래 "실행 전 검증" 후 dotnet ef database update 실행 ...
az sql server firewall-rule delete --resource-group <rg> --server <sqlServerName> --name "TemporaryDevMachine"
```

방화벽 규칙을 연 뒤에도 **`dotnet ef database update`를 곧바로 실행하지 않는다.** 먼저
`__EFMigrationsHistory`를 직접 SELECT해 실제 적용 상태를 확인한다:

```sql
SELECT [MigrationId] FROM [__EFMigrationsHistory] ORDER BY [MigrationId];
```

**2026-09-08 기준**(commit `a314252`), repo에는 총 20개 migration이 있다. 첫 18개(`AddCollections`
계열, `RemoveItemStateAndCategory`, `AddNotifications`/`AddPushNotificationDelivery` 포함)는
2026-09-07 배포 라운드에서 이미 Azure Dev에 적용되었다(위 "현재 배포 상태" 참고). **다음 2개가
account deletion 기능(commit `a314252`)에서 추가되어 아직 미적용이다**(실제 SELECT 결과로 반드시
재확인 - 아래는 repo의 migration 파일을 직접 계산한 목록일 뿐, Azure의 실제 적용 여부를 대신하지
않는다):

1. `AddAccountDeletionBlobCleanup` — `images.AccountDeletionBlobCleanups` 테이블을 새로 생성한다
   (CREATE TABLE만, 기존 테이블 변경 없음).
2. `AddAccountDeletionBlobCleanupFinalSweepAfterUtc` — 위 테이블에 nullable
   `FinalSweepAfterUtc` 컬럼을 추가한다(ADD COLUMN만).

이 2개는 `RemoveItemStateAndCategory`와 달리 순수 추가(새 테이블 생성 + nullable 컬럼 추가)이고
기존 테이블의 컬럼/데이터를 변경·삭제하지 않는다 - data-loss risk나 schema-breaking 하위호환
문제가 없다.

SELECT 결과가 위 목록과 다르면(이미 일부 적용되어 있거나 예상 밖의 상태라면)
`dotnet ef database update`를 실행하지 않고 원인을 먼저 파악한다.

### Migration + API 배포 순서 (maintenance window)

일반 원칙: 새 스키마를 요구하는 이미지가 그 스키마 없이 먼저 트래픽을 받는 구간이 생기지 않도록,
migration을 항상 그 migration을 요구하는 API 이미지 배포보다 먼저 끝낸다.
`RemoveItemStateAndCategory`처럼 schema-breaking(컬럼/테이블 drop, 데이터 이관)인 경우 이 순서를
엄격히 지켜야 하지만, 순수 추가 migration(현재 pending 2개가 이에 해당)은 위험이 더 낮다 - 그래도
같은 순서를 기본값으로 유지한다.

**Account deletion 기능(현재 pending 2개 migration + 아래 "Blob cleanup scheduled Job") 배포 시**:

1. 최신 이미지 build & push 완료
2. App/Job/Blob cleanup Job Bicep에 필요한 모든 secret/parameter 입력값 준비 완료(값 자체는
   미리 Azure에 보내지 않음)
3. Migration 실행 직전 최종 readiness 확인(위 SELECT로 실제 pending 목록 재확인)
4. Pending migration 적용 (`dotnet ef database update`)
5. **성공 즉시** 최신 이미지로 App revision 배포 — 성공과 배포 사이에 다른 작업을 끼우지 않는다
6. API `/health` 확인
7. **Blob cleanup Job 배포** (`infra/azure/blob-cleanup-job/main.bicep`) - account deletion을
   production에 내보내기 전 반드시 완료해야 하는 hard release blocker(아래 섹션 참고)
8. Blob cleanup Job execution/권한 검증 (`az containerapp job start` 1회 + 실행 로그 확인)
9. Account deletion end-to-end 검증
10. SQL 임시 방화벽 규칙 제거

**Migration 실패 시**: 새 API 배포를 진행하지 않고 원인을 먼저 조사한다.
**API 배포 실패 시**: migration이 이미 schema-breaking일 수 있으므로 `Down()`으로 되돌리려 하지
않는다 - 대신 최신 API 배포 자체의 문제를 즉시 복구하는 방향으로 대응한다(스키마는 이미 새
버전이 맞다는 전제 위에서 문제를 해결한다).

### Collaboration + Lock: expand/contract 배포 순서 (maintenance window 없음)

`AddCollectionCollaborationAndLocking`(expand)과 `FinalizeCollectionCollaborationRequiredFields`
(contract)는 rolling deployment 중 쓰기 실패가 없도록 둘로 나뉘어 있다. expand는 순수 추가라서
이전 API revision이 계속 읽고 쓸 수 있다. `Users.PublicCode`/`CollectionItems.AddedByUserId`는
nullable로 추가되고, 이전 revision의 INSERT는 transitional DEFAULT를 받는다(PublicCode는 같은
형식의 실제 Juple ID, AddedByUserId는 "Owner가 추가한 legacy row"를 뜻하는 0). 새 revision은 이
두 column을 required로 매핑하므로 NULL은 절대 만들지 않는다. contract는 0/NULL row를 Owner로
backfill하고 invariant를 검증한 뒤(위반 시 THROW, 전체 rollback) NOT NULL, FK, 최종 unique index를
적용하고 두 DEFAULT를 제거한다. 이 흐름은 `CollectionCollaborationRollingDeployIntegrationTests`가
그대로 재현해서 검증한다.

1. 새 Backend image build/push, tag/digest 확인
2. API Container App에 `collection-unlock-grant-key` secret 준비(값은 출력하지 않는다. Job에는
   넣지 않는다 - one-shot Job 모드는 key 검증 전에 종료한다)
3. SQL 임시 방화벽 규칙, `__EFMigrationsHistory` 확인, **expand만** 적용:
   `dotnet ef database update AddCollectionCollaborationAndLocking ...`
4. 이전 revision이 계속 정상인지 확인(`/health`, 쓰기 오류 로그 없음)
5. 새 image + `CollectionUnlockGrant__EncryptionKey=secretref:collection-unlock-grant-key`로 새
   revision 배포, `/health` 200
6. 새 revision traffic 100%, 이전 revision traffic 0 확인(삭제할 필요는 없다)
7. backfill 대상 확인(read-only): `PublicCode IS NULL` 0건, `AddedByUserId IS NULL OR = 0` 건수
8. contract 적용: `dotnet ef database update FinalizeCollectionCollaborationRequiredFields ...`
9. 최종 상태 확인: 두 column NOT NULL, `UX_Users_PublicCode` unique(filter 없음),
   `FK_CollectionItems_Users_AddedByUserId` trusted, DEFAULT 2개 제거
10. SQL 임시 방화벽 규칙 제거, 이후 Job image/Web/Mobile

contract는 이전 revision이 더 이상 쓰지 않을 때(6번 이후)에만 적용한다. 그 전에 적용하면
이전 revision의 INSERT가 NOT NULL에 막힌다. contract의 `Down()`은 정확히 expand 상태(두 DEFAULT
포함)로 되돌린다.

### Collaboration UX Round 2: 즐겨찾기 expand/contract (DEV 적용 2026-09-26)

`AddCollectionFavoritesAndUserDisplayName`(expand) → 새 API revision 100% → `FinalizeCollectionFavoriteTransition`
(contract) 순서로 적용했다. trigger 브리지는 쓰지 않는다 - `Collections`는 rowversion 때문에 EF가
`UPDATE … OUTPUT`으로 쓰는데, SQL Server는 trigger가 있는 테이블에 이를 거부해서(error 334) 이전
revision의 모든 Collections 쓰기가 실패한다(LocalDB에서 실측). 대신 전환 동안 **Owner의 즐겨찾기는
legacy `Collections.IsFavorite`가 기준**이다: 이전 revision은 그 컬럼만 쓰고, 새 revision은 Owner
즐겨찾기를 그 컬럼에서 읽고 `CollectionFavorites`와 한 transaction으로 dual-write한다. Contributor
즐겨찾기는 `CollectionFavorites`에만 있다. contract는 Owner row를 legacy 컬럼 기준으로 재정리한다.

**Rollback 운영 메모**: contract 이후 이전 revision(`ca-juple-api-dev--0000034` 등)을 다시 traffic에
올리면 그 revision은 Owner의 legacy `IsFavorite`만 바꾸므로 `CollectionFavorites`의 Owner row가 다시
stale해질 수 있다. 현재 revision은 Owner 즐겨찾기를 legacy 컬럼에서 읽으므로 사용자에게 보이는 오류는
없지만, 이전 revision을 재활성화한 적이 있다면 legacy `IsFavorite`를 정리(drop)하기 전에
`FinalizeCollectionFavoriteTransition`과 동등한 reconciliation을 다시 수행해야 한다. 이전 revision은
삭제하지 않지만 정상 rollback 대상으로 취급하지 않는다.

### ad-hoc 방화벽 규칙 (정리 완료)

과거 Azure Portal Query Editor 사용 중 IaC 밖에서 추가됐던 `QueryEditorClientIPAddress_...`
규칙과 2026-09-07 배포 라운드의 임시 migration 규칙은 모두 제거되었다(2026-09-07). 현재 SQL
Server에는 Foundation Bicep이 관리하는 `AllowAzureServices`만 남아 있다.

## 아직 provisioning되지 않은 것

다음은 구독에 실제로 존재하지 않는다(subscription-wide 조회로 확인) — **not provisioned yet**:
Key Vault, Application Insights, Service Bus, Notification Hubs, VNet, Private Endpoint,
Production 실제 custom domain(`juple.co.kr`)/리소스, GitHub Actions 워크플로, **Blob cleanup용
Container Apps Job**(`caj-juple-blob-cleanup-dev` - IaC는 `blob-cleanup-job/main.bicep`으로 이미
준비돼 있다, 아래 "Blob cleanup scheduled Job" 참고, 아직 배포만 안 됐다는 뜻).

Dev의 Web Container App(`ca-juple-web-dev`)과 custom domain(`dev.juple.co.kr`)은 이미 배포·
바인딩되어 있다(아래 "Web Container App"/"Web custom domain" 참고) - DNS/TLS 정상, Android App
Links Dev E2E PASS.

**Production public domain은 여전히 미확정이다.** Android(`appLinksHost` manifest placeholder),
iOS(`JupleMobile.entitlements`의 placeholder, 게다가 Xcode project에 연결조차 안 되어 있다),
Backend(`publicWebBaseUrl`이 기본값 빈 문자열이다) 세 곳 모두 이 값 하나를 기다리는 중이다 -
도메인이 정해지기 전까지 App Links/Universal Links는 켜지지 않지만, 각 플랫폼은 이미 정의된
"미설정 시 안전한 no-op"으로 동작한다(추측 도메인을 채워 넣지 않는다). Web은 Dev 자체 도메인은
이미 있지만 Production 도메인(`juple.co.kr`)은 아직 없다 - 위 "Web custom domain" 섹션 참고.
Push dispatch Job(`caj-juple-push-dispatch-dev`)은 2026-09-07 배포 라운드에서 이미 생성되어
현재 활성 상태다(위 "현재 배포 상태" 참고).
이유와 재검토 시점은 세션 히스토리의 Azure 조사 보고(2026-09-03) 참고.

Firebase 프로젝트(`juple-9fa62`)와 Mobile의 `google-services.json`은 이미 존재한다(Push Stage
2B-1 - Android FCM device registration 연결). Backend의 실제 FCM v1 전송(Push Stage 2B-2)은
Azure Notification Hubs를 사용하지 않기로 확정하고 FCM v1에 Firebase Admin SDK로 직접 전송하는
방식으로 local Backend까지 구현·검증되었다(아래 "Push 알림" 참고). 이 섹션 자체는 Azure 리소스
관점에서 여전히 미착수 상태를 기술한다.

### Push 알림 - Azure Dev 배포 및 E2E 검증 완료 (2026-09-07)

Backend에 Push 알림 전송을 위한 device 등록/delivery idempotency/실제 FCM v1 전송이 구현되어
있고, `infra/azure/job/main.bicep`으로 Container Apps scheduled Job(`caj-juple-push-dispatch-dev`)이
실제로 배포되어 활성 상태다. 실기기(S19B00263) 기준 Job manual execution → 실제 FCM Push 수신 →
tap navigation → RepeatPurchaseDetails 진입 → Log Purchase → 다음 cycle 정상 advance까지
end-to-end 검증 완료. 아래는 그 구성 내용이다:

- Android: FCM v1(legacy server key 아님) - Firebase 서비스 계정 JSON credential이 필요하며,
  Backend는 이를 `Firebase:ServiceAccountKeyJson` 설정(local: `dotnet user-secrets`, Azure:
  Job의 `firebase-credential` secret)으로 읽는다. Mobile의 `google-services.json`(client 설정,
  비밀 아님)과는 완전히 별개다. **API Container App(`ca-juple-api-dev`)에는 이 credential을
  넣지 않는다** - API는 Push를 직접 보내지 않고(device 등록/조회만 담당), 실제 FCM 전송은
  Job만 수행하므로 Job의 독립된 secret 네임스페이스에만 존재한다.
- iOS: APNs 직접 전송 예정(아직 구현되지 않음).
- Azure Notification Hubs는 사용하지 않기로 확정했다 - data-plane SDK가 SAS Access Policy만
  지원해 Managed Identity 인증과 맞지 않고, FCM/APNs를 이미 직접 사용하는 구조에서 추가 계층이
  될 필요가 없다는 판단.
- `infra/azure/job/main.bicep`: `Microsoft.App/jobs` 리소스(`caj-juple-push-dispatch-{environmentName}`),
  같은 `cae-juple-dev` Environment, 같은 backend 이미지를 `args: ["--run-push-dispatch"]`로
  재사용, `triggerType: Schedule`(cron은 항상 UTC, 기본 매시 정각), `parallelism: 1`,
  `replicaCompletionCount: 1`, `replicaTimeout: 600`초(NotificationDeliveryStore의 15분 stale
  lease보다 충분히 짧고, FirebaseCloudMessagingSender의 20초 send timeout보다 충분히 김 -
  실행이 이 한도에 걸려 중단돼도 해당 delivery는 다음 hourly 실행 전에 stale lease로 회수 가능),
  `replicaRetryLimit: 1`(container 자체 crash에 대한 재시도 - delivery 단위 재시도는
  `NotificationDeliveryStore`의 claim/lease가 이미 담당).
- Job이 실제로 필요로 하는 config는 `ConnectionStrings__JupleDatabase`와
  `Firebase__ServiceAccountKeyJson` 단 둘뿐이다(로컬 DLL을 직접 실행해 실측 확인) -
  BlobStorage/PublicWeb/PublicCollectionCursor/Entra Instance·TenantId·ClientId는 Job 코드
  경로에서 전혀 resolve되지 않는다. `Authentication:EntraExternalId:RequiredScope`는
  과거엔 `Program.cs`의 top-level eager validation 때문에 Job에도 의도치 않게 필수였으나,
  이 validation을 API 전용 실행 경로로 옮겨 더 이상 Job에 필요하지 않다(API의 기존 fail-fast
  동작/에러 메시지는 그대로 유지).

Job/Firebase credential 모두 실제로 생성/주입되어 있다(값은 이 문서에 없음).

**E2E fixture 준비 방식(참고, 다음 라운드에서도 재사용)**: 실제 DB INSERT로 RepeatPurchase를
직접 만들지 않고, 가능한 한 정상 API/Mobile UX(로그인 → RepeatPurchase 생성 →
PushDeviceRegistration은 앱의 정상 등록 흐름)로 fixture를 준비한다. Due 시점을 앞당기는 것과 같이
UX로 불가능한 조작만 최소한으로 직접 SQL을 쓴다. raw FCM token은 어떤 로그/출력에도 남기지 않는다.

### Blob cleanup scheduled Job - IaC 준비 완료, Azure 리소스 미생성 (hard release blocker)

Account deletion 기능(commit `a314252`)은 사용자의 Item Blob(사진)을 정리하기 위해 이
scheduled Job에 **정상 동작 여부와 무관하게 항상** 의존한다 - 실패했을 때만 쓰는 rare safety
net이 아니다.

**왜 모든 account deletion에 이 Job이 필요한가**: `DeleteAccountService.DeleteAsync`는 SQL
데이터 삭제와 같은 트랜잭션으로 `AccountDeletionBlobCleanup` task를 등록한 뒤, 그 자리에서
Blob prefix cleanup을 한 번 즉시 시도한다(`IBlobCleanupService.TryCleanupAsync`). 이 즉시 시도가
**성공해서 prefix가 clean으로 확인되어도 task는 바로 삭제되지 않는다** -
`BlobCleanupService.GracePeriod`(10분) 이후의 **두 번째 confirming sweep**이 다시 clean을
확인해야만 비로소 task가 삭제된다. 이유: account deletion이 SQL에 commit되기 전에 이미 인증 +
소유권 확인을 통과한 upload 요청이, commit 이후에도 Blob PUT을 완료할 수 있는 좁은 race가
존재하기 때문이다(그 요청의 `ItemImages` insert는 FK 위반으로 실패하고 compensating delete가
시도되지만, 이 delete는 best-effort라 실패할 수 있다). 10분은 Mobile
업로드 요청의 자체 타임아웃(`UPLOAD_TIMEOUT_MS`, 120초)과 그 취소 신호가 전파되는 데 걸리는
시간에 네트워크/스토리지 지연과 margin을 더해 정한 값이다 - 120초를 Blob 작업의 수학적 상한으로
가정한 값이 아니다.

**결론**: 이 scheduled Job(`--run-blob-cleanup-retry`)이 Azure에 실제로 배포되어 주기적으로
실행되기 전까지는, 정상적으로 성공한 account deletion조차 grace period 이후의 confirming sweep을
받지 못해 cleanup task가 영구히 pending 상태로 남는다. **따라서 이 Job은 account deletion 기능의
production release를 막는 hard release blocker다** - account deletion API만 먼저 production에
내보내는 것은 금지한다.

**설계**:

- `infra/azure/blob-cleanup-job/main.bicep` - `infra/azure/job/main.bicep`(Push dispatch)과
  **의도적으로 분리된 별도 리소스/별도 Bicep 파일**이다. 두 Job은 lifecycle과 config가 완전히
  다르다(이 Job은 Firebase를 전혀 요구하지 않고, Push Job은 Blob Storage를 전혀 요구하지
  않는다) - 하나로 묶어 all-or-nothing으로 배포할 이유가 없다. 기존 `job/main.bicep`은 이번
  작업에서 수정하지 않았다.
- Resource: `Microsoft.App/jobs@2024-03-01`(Push Job과 동일 API version), 이름
  `caj-juple-blob-cleanup-{environmentName}`.
- 같은 `cae-juple-dev` Environment, 같은 backend 이미지를 재사용 - 별도 worker 이미지를 만들지
  않았고 Dockerfile ENTRYPOINT도 그대로 유지, `args: ["--run-blob-cleanup-retry"]`만 전달한다.
- `triggerType: Schedule`, cron `*/5 * * * *`(**UTC** - Container Apps Job schedule은 항상
  UTC), `parallelism: 1`, `replicaCompletionCount: 1`, `replicaTimeout: 240`초(5분 주기보다
  짧게 잡아 다음 실행과 정상적으로 겹치지 않도록 함), `replicaRetryLimit: 0`(다음 5분 뒤 스케줄
  실행 자체가 재시도 역할을 하므로 즉시 whole-Job 재시도는 불필요 - Push Job의
  `replicaRetryLimit: 1`과 다른 값이며, 이유는 Bicep 파일 자체의 파라미터 설명 참고).
  5분 간격은 10분 grace period의 수학적 필수조건이 아니다(더 긴 간격이어도 언젠가는 confirming
  sweep이 실행된다) - orphan Blob/cleanup task의 체류 시간과 운영 관찰성을 위해 짧게 잡은 값이다.
- Job이 실제로 필요로 하는 config는 4개뿐이다(코드 근거: `DependencyInjection.AddInfrastructure`의
  `ConnectionStrings:JupleDatabase` eager 체크, `BlobServiceClientFactory.Create`의
  `BlobStorage:ServiceUri`/`DefaultAzureCredential` 경로, `AZURE_CLIENT_ID`로 특정 UAMI를
  선택하는 기존 App 패턴 재사용):
  - `ConnectionStrings__JupleDatabase` (Job 자체 secret)
  - `BlobStorage__ServiceUri` (Foundation output `storageBlobServiceUri`)
  - `BlobStorage__ContainerName` (App과 동일한 `item-images` 기본값)
  - `AZURE_CLIENT_ID` (Foundation output `managedIdentityClientId`)
- **Firebase 관련 config/secret은 전혀 넣지 않는다** - 이 Job은 FCM/Push와 무관하다. 마찬가지로
  Entra/PublicWeb/PublicCollectionCursor config도 넣지 않는다 - `Program.cs`의
  `isOneShotJob`(Push Job과 공유) 분기가 이미 이런 API 전용 config 요구사항을 건너뛴다.
- **Storage 인증은 Managed Identity + Blob Service URI만 사용한다** - Storage Account key,
  Blob Storage connection string, SAS write credential, 새 Service Principal 중 어느 것도
  추가하지 않았다. 기존 UAMI(`id-juple-dev`)의 `AcrPull`(ACR pull용)과
  `Storage Blob Data Contributor`(Blob 접근용) role assignment를 그대로 재사용하며, 새 role
  assignment는 만들지 않았다(둘 다 Foundation에 이미 존재 - `../foundation/resources.bicep`).

**Idempotency/동시성**: `BlobCleanupService`/`AccountDeletionBlobCleanupStore`를 검토한 결과
별도의 claim/lease/distributed lock 없이도 안전하다 - `ItemImageStore.DeleteBlobsByPrefixAsync`는
`DeleteIfExistsAsync` 기반이라 이미 지워진 Blob을 다시 지워도 에러 없이 안전하고, 모든 store
mutation(`RecordFailedAttemptAsync`/`ScheduleFinalSweepAsync`/`DeleteAsync`)은 이미 사라진
행에 대해 조용히 no-op한다(인터페이스 자체에 문서화됨). 즉 두 execution이 같은 pending task를
동시에 처리해도 데이터 손상이 없다 - `replicaTimeout`을 schedule 간격보다 짧게 둔 것은 이 안전성에
의존하기 위해서가 아니라 겹침 자체를 굳이 유발하지 않기 위한 예방적 선택이다.

### Instagram metadata retry scheduled Job

Mobile 앱은 Item 저장 직후 URL metadata를 한 번 best-effort로 resolve해서 title/preview image를
채운다(`enrichItemTitleFromUrlMetadata`/`enrichItemPreviewImageFromUrlMetadata`). 여러 차례의
실기기 조사로, 공개 Instagram post에 대해 이 첫 시도가 간헐적으로 빈 결과를 받는 것은 **Juple 쪽
요청 방식(cookie/URL canonicalization/network origin)의 결함이 아니라 Instagram 쪽의 일시적
동작**임이 확인됐다 - 동일한 URL이 어떤 시점엔 실패하고 몇 분 뒤 재요청하면 그대로 성공한다.
`InstagramMetadataRetryTask`/`InstagramMetadataRetryService`는 이 최초 시도가 비어 있는 채로
끝난 공개 Instagram Item에게 **최대 2번의 추가 backend 시도**(Item 저장 후 약 1분, 약 5분 시점)를
주는 durable backstop이다 - Item 저장 자체는 이 기능과 무관하게 항상 즉시 성공한다(이미 그랬다).

**설계**:

- `infra/azure/instagram-metadata-retry-job/main.bicep` - Push/Blob cleanup Job과 완전히
  분리된 별도 리소스. Blob Storage/Firebase parameter가 없다 - SQL 접근과 (API Container App과
  동일한) outbound HTTPS(Instagram fetch)만 필요.
- Resource: `Microsoft.App/jobs@2024-03-01`, 이름 `caj-juple-ig-metadata-retry-{environmentName}`(Container
  Apps Job 이름 32자 제한 때문에 축약됨).
- 같은 `cae-juple-dev` Environment, 같은 backend 이미지 재사용, `args:
  ["--run-instagram-metadata-retry"]`만 전달(Program.cs의 one-shot 분기, `--run-blob-cleanup-retry`와
  동일한 패턴).
- `triggerType: Schedule`, cron `* * * * *`(**UTC**, 매분) - Blob cleanup Job의 5분보다 촘촘한
  이유는 1분/5분 시점의 재시도 스케줄을 놓치지 않기 위해서다. `parallelism: 1`,
  `replicaCompletionCount: 1`, `replicaTimeout: 45`초(1분 주기보다 짧게), `replicaRetryLimit: 0`
  (다음 분의 스케줄 실행 자체가 재시도 역할).
- **동시성**: `InstagramMetadataRetryStore.TryClaimAsync`가 `ClaimedAtUtc IS NULL` 조건의 단일
  atomic UPDATE로 두 execution이 같은 task를 동시에 처리하는 것을 막는다(claim은 매 attempt
  이후 해제되고, 죽은 worker의 stale claim은 2분 뒤 재claim 가능). 신규 후보 discovery는
  `ItemId`의 unique index로 동시 등록을 방어한다.
- **Storage**: `items.InstagramMetadataRetryTasks` 신규 테이블 하나만 추가(migration
  `AddInstagramMetadataRetryTask`) - `Items.Title`/`Items.PreviewImageUrl` 컬럼은 그대로 재사용,
  새 컬럼 없음.

Dev 배포/실기기 검증 상태는 이 문서가 마지막으로 갱신된 커밋의 커밋 메시지와 배포 로그를 참고.

### Web Container App - IaC 준비 완료, Azure 리소스 미생성

`apps/web`(Public Collection Sharing Web Viewer, Next.js 16, `/c/[publicId]` +
`.well-known/apple-app-site-association` + `.well-known/assetlinks.json`)을 배포할
`Microsoft.App/containerApps` 리소스(`ca-juple-web-{environmentName}`)가 `web/main.bicep`으로
준비되어 있다. API/Job과 완전히 별개 리소스/이미지이며, DB/Blob Storage 권한도 secret도 전혀
필요하지 않다 - Managed Identity는 ACR pull 용도로만 재사용한다(새 role assignment 없음).

**빌드 방식**: `apps/web/Dockerfile`(신규, multi-stage) - `next.config.ts`의 `output: 'standalone'`
으로 `next start`가 실제로 필요로 하는 파일만 추려 이미지에 담는다. 로컬에서 실제로
`docker build`/`docker run`까지 실행해 검증했다.

**모든 환경값이 runtime env다 - build-arg가 하나도 없다.** 처음엔 `NEXT_PUBLIC_JUPLE_API_BASE_URL`
등 4개를 `NEXT_PUBLIC_` 접두사로 두어 `next build` 시점에 결과물에 굳혀 넣었으나(Next.js
공식 문서로 확인: `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`),
"같은 이미지를 Dev/Staging/Prod에서 재빌드 없이 쓴다"는 목표와 맞지 않아 전부 접두사 없는
runtime 변수로 옮겼다:

- `lib/publicApi.ts`의 API 호출 함수들이 `apiBaseUrl`을 인자로 받도록 변경 - 더 이상 모듈이
  직접 env를 읽지 않는다.
- `app/c/[publicId]/page.tsx`(이미 `headers()`를 쓰는 dynamic 페이지)가 매 요청마다
  `process.env.JUPLE_API_BASE_URL`을 읽어 그 값을 API 호출과 `ItemList`(Client Component, "더
  보기" pagination을 브라우저에서 직접 fetch) props로 그대로 내려준다 - Client Component는 어떤
  env도 직접 읽지 않고, 그 요청의 RSC/HTML payload 안 평범한 문자열 prop으로만 값을 받는다.
- `lib/storeConfig.ts`(`GOOGLE_PLAY_URL`/`APP_STORE_URL`/`APP_STORE_APP_ID`)도 마찬가지로
  접두사를 뗐다 - 이 값들은 Server Component(`InstallCta`)/`generateMetadata`에서만 쓰이므로
  애초에 client bundle 노출 우려가 없었다.

그 결과 `Dockerfile`은 `ARG`/build-time `ENV`가 전혀 없는 평범한 `RUN npm run build`가 되었고,
이전 라운드에서 넣었던 `RUN sh -c '[ -z "$X" ] && unset X; ...'` workaround(Docker `ARG`가
"미설정"이 아니라 빈 문자열이 되어 `lib/publicApi.ts`의 `?? 'http://localhost:5092'`를
깨뜨렸던 실측 버그의 우회책)도 함께 제거했다 - 애초에 그 값을 build-time에 다루지 않으므로
이제 이 문제 자체가 발생하지 않는다.

**하나의 image, 서로 다른 runtime env로 실제 검증**: 동일한 image(`docker inspect`로 image ID
동일 확인)를 두 번 실행 - 한 번은 가짜 Public API A + `env-a` 스토어 URL로, 한 번은 가짜 Public
API B + `env-b` 스토어 URL로. `/c/{publicId}` SSR 결과(Collection 이름, Install CTA 링크,
`ItemList`에 내려간 `apiBaseUrl` prop)와 `.well-known` 두 라우트가 재빌드 없이 컨테이너 실행
시점 env만으로 정확히 갈리는 것을 확인했다.

**Store/App ID는 아직 실값이 없다** - `web/main.bicep`의 `googlePlayUrl`/`appStoreUrl`/
`appStoreAppId`/`iosAppId` 파라미터는 전부 기본값 빈 문자열이고, 가짜 값을 채워 넣지 않았다.
출시 준비(Apple Developer Team ID 확보, Play App Signing 활성화, Play/App Store 리스팅 등록)
시점에 실값으로 재배포하면 된다 - 이미지 재빌드도, 코드/IaC 구조 변경도 필요 없다.

**`androidAssetlinksSha256Fingerprints`는 실값이 있다(fingerprint 2개, comma-separated)** -
`dev.bicepparam`의 자체 주석 참고. 첫 번째는 Android App Links Dev E2E 검증을 위해
`ca-juple-web-dev`에 CLI로 직접 설정되어(이 Bicep 배포를 거치지 않고) 이미 PASS한 값으로, 이후
실기기의 기존 설치본을 `adb shell dumpsys package`로 대조해 이 PC의
`apps/mobile/android/app/debug.keystore` fingerprint임을 확인했다. 두 번째는 home-PC Dogfood
keystore의 fingerprint(위 "Dogfood signing" 섹션) - standalone `assembleDogfood` 설치본도 같은
도메인의 App Links를 검증받을 수 있도록 추가했다. `dev.bicepparam`이 두 값을 literal로 고정해
재배포로 유실되지 않게 한다 - 아래 "Web custom domain" 섹션의 `dev.bicepparam` 구성 참고.

### Web custom domain (`dev.juple.co.kr`) - IaC state의 일부

Dev의 `ca-juple-web-dev`에는 `dev.juple.co.kr`이 실제로 bound되어 있고 DNS/TLS도 정상이다
(managed certificate `mc-cae-juple-dev-dev-juple-co-kr-6698`, Android App Links Dev E2E도
PASS). **이 binding은 처음에 `az containerapp hostname add`/`bind` CLI로만 추가됐었는데,
`Microsoft.App/containerApps`의 `properties.configuration.ingress`는 매 Bicep 배포마다 전체가
교체(merge가 아니라 replace)되는 속성이라, `customDomains`를 선언하지 않는 `web/main.bicep`을
그대로 재배포하면(런타임 env 하나만 바꾸는 재배포라도) 이 binding이 즉시 사라지고 TLS가
깨지는 사고가 있었다** - managed certificate 리소스 자체는 살아남지만 Container App의
hostname binding만 초기화된다.

그래서 지금은 `configuration.ingress.customDomains`를 `web/main.bicep`이 직접 선언한다
(`customDomainName`/`managedCertificateName` 파라미터, 위 코드 참고). **`web/main.bicep` 자체는
environment-neutral하다** - 두 파라미터 모두 기본값이 빈 문자열이고(`customDomains: []`), Dev
전용 값을 템플릿에 두지 않는다. Dev의 실제 값은 대신 `infra/azure/web/dev.bicepparam`
(이 repo의 첫 `.bicepparam` 파일)에 고정한다.

**같은 문제가 `app/main.bicep`에도 그대로 있었다** - `entraInstance`/`entraTenantId`/
`entraClientId`가 Dev tenant 값을 파라미터 default로 갖고 있었고, `customDomains`를 아예
선언하지도 않았다(Web의 이 fix가 적용되기 전과 동일한 상태). Entra 쪽은 override를 빼먹어도
"그냥 Dev tenant로 계속 인증"이라 binding처럼 즉시 눈에 띄게 깨지진 않지만, Production이 조용히
Dev tenant를 통해 인증을 처리하게 된다는 점에서 실질적으로 같은 위험이었다. 지금은 `app/main.bicep`
도 Web과 동일하게 두 가지를 모두 고쳤다: entraInstance/entraTenantId/entraClientId는 기본값 없이
필수 파라미터로 바뀌었고(entraRequiredScope는 tenant에 종속되지 않는 값이라 기본값 유지),
`customDomainName`/`managedCertificateName`/`containerAppsEnvironmentName` +
`configuration.ingress.customDomains`도 Web과 동일한 구조로 추가되었다(`api.juple.co.kr` 등
API 자체의 custom domain을 위한 것 - Dev에는 아직 bind되어 있지 않아 `app/dev.bicepparam`에서
둘 다 빈 문자열이다). Dev의 실제 Entra/PublicWeb 값은 `infra/azure/app/dev.bicepparam`에
고정한다(live `az containerapp show` 결과로 재확인한 값 - 추측 없음).

Certificate는 `Microsoft.App/managedEnvironments/managedCertificates`의 기존 리소스를
`resourceId(...)`로 참조만 한다 - 이 템플릿이 새 certificate를 발급하거나 갱신하는 일은 없다.

**`dev.bicepparam`의 구성**(전체는 파일 자체의 헤더 주석 참고):

- `environmentName`/`containerAppsEnvironmentName`(Naming 표의 `cae-juple-{environmentName}`
  패턴으로 결정되는 이름, 추측이 아니다)/`customDomainName`/`managedCertificateName`/
  `androidAssetlinksSha256Fingerprints` - Dev 환경에 대한 고정된 사실이라 파일에 literal로
  커밋해도 안전한 값. `androidAssetlinksSha256Fingerprints`는 secret이 아니다 - 서명 인증서의
  public fingerprint이며, `.well-known/assetlinks.json`으로 이미 공개 서빙되는 값과 동일하다.
- `acrLoginServer`/`containerAppsEnvironmentId`/`managedIdentityResourceId`/`imageTag`/
  `apiBaseUrl` - non-secret이지만 subscription ID를 포함하거나(리소스 ID) 배포마다 바뀌는
  live 값(image tag, API의 실제 FQDN)이라 파일에 literal로 적을 수 없다. Azure CLI가
  `.bicepparam` 사용 시 `--parameters`를 한 번만 허용해서(위 "명령 예시" 6번 참고, `az
  deployment group create --help`로 확인) 별도 `--parameters key=value`로 채울 수도 없다 -
  대신 파일 안에서 `readEnvironmentVariable('JUPLE_WEB_...')`로 읽는다. 배포자가 `az
  deployment group create` 실행 전에 그 이름의 환경변수를 shell에 설정해야 하며(위 "명령 예시"
  6번의 `$env:JUPLE_WEB_...` 참고), 설정하지 않으면 `az bicep build-params`/실제 배포 모두
  명확한 에러(BCP427)로 즉시 실패한다 - 조용히 빈 문자열로 배포되지 않는다.

**신규 환경(아직 domain이 없는 환경)에서는** `customDomainName`/`managedCertificateName`을
아예 지정하지 않으면(파라미터 파일 없이 `main.bicep`을 직접 배포하거나, 그 둘이 없는 자체
parameter 파일을 쓰면) `main.bicep`의 기본값(둘 다 `""`)이 적용되어 `customDomains: []`로
안전하게 배포된다(`hasCustomDomain` 변수 참고) - Dev/Prod 어느 쪽도 다른 환경의 값을 실수로
상속할 수 없다.

**Production(`juple.co.kr`/`api.juple.co.kr`) 적용 시**도 같은 구조를 재사용한다 -
`infra/azure/web/prod.bicepparam`과 `infra/azure/app/prod.bicepparam`이 이미 이 repo에
준비되어 있다(둘 다 Production Foundation/리소스가 아직 없으므로 `customDomainName`/
`managedCertificateName`은 일단 빈 문자열, 나머지 live 값은 `readEnvironmentVariable(...)`로
fail-closed 처리 - 실제 리소스가 생기기 전에 배포를 시도하면 추측값 대신 명확한 BCP427 에러로
막힌다). Production Foundation/리소스가 실제로 생기고 각 domain이 실제로 bind된 뒤,
`customDomainName=juple.co.kr`(Web)/`api.juple.co.kr`(App), `managedCertificateName=<실제
Managed Certificate 이름>`으로 그 두 줄만 채우면 된다. `main.bicep` 자체의 구조 변경은
필요 없다.

**배포/연결 순서**(Dev는 1~5 완료, 아래는 향후 재배포/Production 적용 시 참고용):

1. `web/main.bicep` + `web/dev.bicepparam`으로 Web Container App 배포(위 "명령 예시" 6번) -
   `containerAppFqdn`(`*.azurecontainerapps.io`)만으로도 `/c/{publicId}` 접근은 즉시 가능하다.
2. 실 production domain 확정.
3. Web/API 각각에 그 도메인을 custom domain으로 최초 연결(Container Apps 기능, `az containerapp
   hostname add`/`bind` - 이 최초 binding/도메인 검증 자체는 여전히 이 Bicep 밖의 1회성 단계다).
   이후에는 해당 `prod.bicepparam`의 `customDomainName`/`managedCertificateName`으로 그 결과를
   IaC에도 반영해 재배포마다 유지되게 한다(위 참고) - Web/API는 완전히 독립된 hostname/certificate
   쌍이라 각자 따로 진행한다.
4. `app/main.bicep`의 `publicWebBaseUrl`을 그 도메인으로 재배포(위 "명령 예시" 7번 참고 - Dev는
   이미 `app/dev.bicepparam`에 고정 반영되어 있어 별도 조치가 필요 없었다) - 이 값이 바뀌기 전까지
   공유 URL은 계속 구버전 origin으로 조립된다.
5. Android(`JUPLE_PUBLIC_WEB_HOST`)/iOS(entitlements, Mac 필요)에 같은 도메인을 반영하고,
   Web의 `.well-known` 두 라우트가 실제로 올바른 값을 서빙하는지(fingerprint/Team ID 확보 후)
   확인해야 App Links/Universal Links가 실제로 동작한다.

### Production SKU/scale - parameter 파일 준비 완료, Azure 리소스 미생성

Production 최초 출시용 SKU/scale이 확정되어 각 `prod.bicepparam`에 literal로 반영되어 있다(Dev는
변경 없음, 아래 값 전부 기존 `main.bicep` parameter override만으로 적용 - template 자체는 수정하지
않았다):

- **API**(`app/prod.bicepparam`): `minReplicas=1`/`maxReplicas=3`/`containerCpu='0.5'`/
  `containerMemory='1Gi'` - Dev의 scale-to-zero(`0`/`1`/`0.25`/`0.5Gi`)와 달리 인스턴스 1개를
  상시 가동해 실사용자 첫 요청의 cold start를 없앤다. `minReplicas=1`이 이 repo의 Prod 상시 비용의
  핵심 항목이다.
- **Web**(`web/prod.bicepparam`): `minReplicas=0`(scale-to-zero 유지 - 익명 조회 전용 SSR이라
  cold start 허용 가능)/`maxReplicas=2`. CPU/memory는 Dev와 동일한 `0.25`/`0.5Gi` 유지(가벼운
  SSR/프록시 워크로드).
- **SQL**(`foundation/prod.bicepparam`, 신규): `sqlDatabaseSku={name:'S0', tier:'Standard'}` -
  Dev의 Basic(5 DTU/2GB)은 실사용자 트래픽이 매시 Push Job/5분 간격 Blob cleanup Job과 같은
  DB를 동시에 두드리는 구조에서 throttling 위험이 있어 상향했다. Serverless(auto-pause)는
  API의 `minReplicas=1`(상시 warm) 목적과 상충해(SQL이 auto-pause에서 깨어나는 지연이 API의
  warm 상태를 무의미하게 만듦) 검토 후 배제했다.
- **유지**: ACR Basic, Storage `Standard_LRS`, Log Analytics 30일 보존, Push/Blob cleanup Job
  cadence 전부 그대로 - 변경 근거가 없었다.

`foundation/prod.bicepparam`은 이 repo의 첫 Foundation parameter 파일이다 - `app`/`web`의
`dev.bicepparam`/`prod.bicepparam`과 동일한 convention을 따른다: `environmentName`/
`sqlDatabaseSku`는 Production에 대한 고정된 사실이라 literal, `sqlAdministratorLoginPassword`는
secret이라 `readEnvironmentVariable('JUPLE_FOUNDATION_PROD_SQL_ADMINISTRATOR_LOGIN_PASSWORD')`로
fail-closed 처리한다(값 미설정 시 BCP427로 즉시 실패 - 이 비밀번호는 아직 실제로 생성되지
않았다). Foundation 배포 시:

```powershell
$env:JUPLE_FOUNDATION_PROD_SQL_ADMINISTRATOR_LOGIN_PASSWORD = '<신규 생성한 Prod SQL admin 비밀번호>'
az deployment sub create --location koreacentral --parameters infra/azure/foundation/prod.bicepparam
```

## Naming

| 리소스 | 패턴 | 비고 |
| --- | --- | --- |
| Resource Group | `rg-juple-{environmentName}` | |
| Managed Identity | `id-juple-{environmentName}` | |
| ACR | `acrjuple{environmentName}{suffix}` | 전역 고유, 하이픈 불가 — `uniqueString(resourceGroup().id)` 기반 suffix |
| Storage Account | `stjuple{environmentName}{suffix}` | 전역 고유, 하이픈 불가, 소문자 |
| Azure SQL Server | `sql-juple-{environmentName}-{suffix}` | 전역 고유 |
| Log Analytics | `log-juple-{environmentName}` | |
| Container Apps Environment | `cae-juple-{environmentName}` | |
| Container App | `ca-juple-api-{environmentName}` | |
| Container App | `ca-juple-web-{environmentName}` | Public Collection Sharing Web Viewer(`apps/web`) 전용, API와 별개 리소스/이미지, secret 없음 |
| Container Apps Job | `caj-juple-push-dispatch-{environmentName}` | Push dispatch 전용, API와 별개 secret 네임스페이스 |
| Container Apps Job | `caj-juple-blob-cleanup-{environmentName}` | Account deletion Blob cleanup 전용, Firebase 불필요, Push Job과 별개 secret 네임스페이스 |

`environmentName`은 모든 템플릿에서 parameter다. `foundation/main.bicep`의 `@allowed`는
`dev`/`prod` 둘 다 허용한다(Production Foundation은 아직 실제로 배포되지 않았을 뿐, 템플릿 자체는
막혀 있지 않다) - 같은 템플릿을 그대로 재사용해 생성한다. Staging은 여전히 고려 단계다.
