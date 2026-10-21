# iOS 푸시 (APNs) - Backend 계약과 MacBook 작업 가이드

Backend는 iOS 기기에 **Apple APNs로 직접** 푸시를 보낸다(Firebase/Notification Hubs 없음). Android는 기존 FCM 그대로다.
MacBook에서 할 일은 **APNs 기기 토큰을 받아 기존 등록 API로 보내는 네이티브 연결**과 **알림 수신/탭 처리**뿐이다.
이 문서 시점에 Backend 코드와 로컬 테스트는 완료됐고, PROD 배포·PROD DB migration·APNs 키 설정은 아직 하지 않았다.
앱 쪽(5장)은 구현되었다: `ios/JupleMobile/ApnsBridge.swift`, `JupleApnsModule.mm`, `src/share/specs/NativeApnsIOS.ts`, `src/push/apnsPush.ts`. Simulator에서 sandbox 토큰 발급과 `simctl push` 수신·탭 라우팅을 확인했고, APNs 서버를 거친 실제 발송과 실기기 동작은 아직 확인하지 않았다.

## 1. 전체 흐름

```
Juple 이벤트 -> notifications.NotificationEvents (outbox, 같은 SQL 트랜잭션)
  -> notification worker / push-dispatch Job (수신자 계산, Notification 행)
  -> 수신자의 활성 기기 목록 (push.PushDeviceRegistrations, IsEnabled = 1)
  -> PlatformPushSender: Android -> FCM (기존, 변경 없음) / iOS -> APNs (신규)
  -> NotificationDeliveries (알림 x 기기별 결과)
```

- 한 사용자가 Android와 iPhone을 동시에 쓰면 같은 알림이 기기마다 한 번씩 간다. 결과는 기기별로 기록되고, 실패한 기기만 재시도된다.
- 자기 알림 방지, 권한(멤버십·차단·알림 끄기) 판정, 알림 유형별 만료(MaxAge)는 기존 파이프라인이 플랫폼과 무관하게 처리한다.
- APNs 장애나 예외는 그 iPhone 한 대의 실패로만 기록되고, 같은 배치의 Android 발송을 막지 않는다.

## 2. 토큰 등록 API (기존 엔드포인트, iOS 필드만 추가)

`PUT /api/v1/push/devices` (로그인 필요, Bearer 토큰)

```json
{
  "platform": "ios",
  "installationId": "앱 설치마다 한 번 생성해 저장하는 UUID",
  "pushToken": "APNs device token (hex 문자열)",
  "locale": "ko",
  "apnsEnvironment": "production"
}
```

| 필드 | 규칙 |
| --- | --- |
| `platform` | `"ios"` (Android는 `"android"`, 기존 그대로) |
| `installationId` | 앱 설치 1개당 고정 UUID, 최대 100자. 기존 `pushInstallationId.ts`를 그대로 쓴다 |
| `pushToken` | `didRegisterForRemoteNotificationsWithDeviceToken`의 `Data`를 **소문자/대문자 hex 문자열**로 바꾼 값. 64-200자, 짝수 길이, hex만 허용(서버가 소문자로 정규화). FCM 토큰을 보내면 400 |
| `locale` | 앱 UI 언어(`i18n.language`). 푸시 문구 언어가 이 값으로 정해진다 |
| `apnsEnvironment` | 앱의 `aps-environment` entitlement 값: Xcode 빌드 `"development"`, TestFlight·App Store `"production"`. 생략하면 `"production"`. Android에 보내면 400 |

응답 200: `{ "id", "platform": "ios", "installationId", "isEnabled": true, "updatedAtUtc" }` (토큰은 절대 응답에 없다).
오류: 400 `ValidationProblemDetails` (`platform`, `pushToken`, `apnsEnvironment` 등 필드별), 409 bootstrap 전.

**해제(로그아웃)**: `DELETE /api/v1/push/devices/{installationId}` -> 204. 기존 Android 로그아웃 흐름(`pushLogoutUnregister.ts`)과 같다.

### 서버 쪽 보장

- (platform, installationId)는 전역에서 하나다. 같은 설치가 다른 계정으로 등록되면 그 행의 소유자가 바뀐다(계정 전환).
- **같은 토큰은 한 등록에만 살아 있다.** 다른 installationId나 다른 계정에 같은 토큰이 활성 상태로 남아 있으면 새 등록 시 비활성화된다. 그래서 한 iPhone이 이전 계정의 알림을 받는 일이 없다.
- APNs가 토큰을 영구 무효로 알리면(410 Unregistered, 400 BadDeviceToken, 400 DeviceTokenNotForTopic) 그 등록만 비활성화된다. 앱이 다음 실행 때 현재 토큰을 다시 등록하면 자동으로 다시 활성화된다.
- 동시 등록: 한 등록은 하나의 트랜잭션에서 `sp_getapplock`으로 **설치(installation) -> 토큰** 순서로 잠근다. 같은 설치의 동시 등록(앱 2중 실행, 계정 전환)은 순서대로 처리되어 행 하나·소유자 하나가 되고, 같은 토큰의 다른 설치 동시 등록은 마지막 것만 활성으로 남는다(둘 다 활성/둘 다 비활성 없음). 잠금 순서가 항상 같아 등록끼리 deadlock이 나지 않으며, 다른 작업과의 deadlock은 최대 3회 재시도한다. unique index `(Platform, InstallationId)`는 그대로 최종 방어선이다.
- Android 기존 앱은 요청 형태가 그대로다(`apnsEnvironment` 없음 -> NULL, FCM 토큰 형식 검사·소문자 변환 없음).

## 3. 앱이 받는 페이로드

```json
{
  "aps": { "alert": { "title": "새 링크", "body": "…" }, "sound": "default", "badge": 2 },
  "type": "collectionItemsAdded",
  "notificationId": "12345",
  "collectionId": "67"
}
```

- `aps` 밖의 키는 Android FCM `data`와 **완전히 같은 키/문자열 값**이다(`type`, `notificationId`, `collectionId` 또는 `publicId`, `invitationId`). 그래서 `userInfo`에서 `aps`를 뺀 맵을 기존 `parseSocialPushEvent()`에 그대로 넘기면 된다.
- data-only 알림(화면 갱신 신호: `collectionContentChanged`, `collectionInvitationAnswered`)은 `aps.content-available: 1`, alert 없음, `apns-push-type: background`, priority 5로 온다. 앱이 백그라운드면 iOS가 전달을 보장하지 않으므로 갱신 신호로만 쓴다(Android와 같은 의미).
- 서버 헤더: `apns-topic: com.juple.app`, `apns-collapse-id: n{notificationId}`(같은 알림이 재전송돼도 배너는 하나), `apns-expiration`(유형별 만료 시각: 일반 6시간, data-only 10분).
- `badge`는 서버에 수가 있을 때만 들어간다. 없으면 배지를 건드리지 않는다.

## 4. Apple Developer 설정 (계정 소유자가 직접)

1. **App ID** `com.juple.app`: Capabilities에서 **Push Notifications** 활성화.
2. **Keys** -> + -> **Apple Push Notifications service (APNs)** 체크 -> 생성 -> `AuthKey_XXXXXXXXXX.p8` 다운로드(**한 번만** 받을 수 있다). Key ID(10자)와 Team ID(10자, Membership 화면)를 기록한다. 하나의 .p8 키로 sandbox·production 둘 다 보낼 수 있다.
3. .p8 파일은 저장소·채팅·메일에 두지 않는다. Key Vault에 보관한다(아래 6).
4. Provisioning profile 재생성(Push capability 포함). Xcode의 자동 서명이면 Xcode가 처리한다.

인증서 기반(.p12) APNs는 쓰지 않는다. 토큰 기반(.p8)만 지원한다.

## 5. MacBook에서 할 일 (iOS Native + RN)

아래는 구현 시의 작업 목록이다(구현 완료 - 위 상태 참고). `isFcmPlatform()`은 iOS에서 false이고, iOS는 `apnsPush.ts`로 등록한다. iOS에는 Firebase 앱이 없으므로 **`@react-native-firebase/messaging`을 iOS에서 쓰지 않는다.**

1. Xcode -> Signing & Capabilities -> **+ Capability -> Push Notifications** (entitlements에 `aps-environment` 추가됨: Debug `development`, Release는 배포 시 `production`).
   - 완료: Xcode가 기존 `JupleMobile.entitlements`에 연결했고 `aps-environment`가 들어 있다(Associated Domains 상태는 README 참고).
   - **Background Modes -> Remote notifications**: data-only 갱신 신호를 백그라운드에서도 받고 싶을 때만 켠다(선택).
2. 작은 네이티브 모듈(예: `JupleApnsModule`, 기존 `JupleNotificationPermissions.mm`과 같은 방식):
   - 권한이 허용된 상태에서 `UIApplication.shared.registerForRemoteNotifications()` 호출.
   - `AppDelegate`의 `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`에서 `deviceToken.map { String(format: "%02x", $0) }.joined()`로 hex를 만들고 JS로 전달(Promise resolve + 토큰 변경 이벤트).
   - `didFailToRegisterForRemoteNotificationsWithError`는 실패로 전달(`tokenFailed`).
   - `apnsEnvironment`는 **빌드 설정(`#if DEBUG`)이 아니라 서명에 쓰인 provisioning profile**이 정한다. Release 구성이라도 development profile로 서명하면 sandbox 토큰이 나온다. 앱 번들의 `embedded.mobileprovision`에 `aps-environment`가 `development`로 들어 있으면 `"development"`, 파일이 없거나(App Store/TestFlight 설치본에는 없다) `production`이면 `"production"`을 보낸다. 잘못 보내면 APNs가 `BadDeviceToken`으로 거절하고 서버가 그 등록을 비활성화한다(다음 실행 때 올바른 값으로 다시 등록하면 복구).
   - `UNUserNotificationCenter.current().delegate`는 `AppDelegate.application(_:didFinishLaunchingWithOptions:)`에서 **실행이 끝나기 전에** 설정한다. 그래야 앱이 꺼진 상태에서 알림을 탭해 실행한 경우에도 `didReceive`가 호출된다(이 프로젝트는 `SceneDelegate`를 쓰지만 알림 delegate는 앱 단위다).
   - `UNUserNotificationCenterDelegate`:
     - `willPresent`: 앱이 포그라운드일 때 `userInfo`(aps 제외)를 JS로 보내고 시스템 배너는 띄우지 않는다(Android와 같이 앱 내 배너로 처리).
     - `didReceive`(탭): `userInfo`를 JS로 보낸다. 앱이 꺼져 있다가 탭으로 실행된 경우의 최초 알림도 JS가 가져갈 수 있게 보관한다.
3. JS(`src/push`):
   - `pushRegistrationSync.ts`: iOS면 FCM `getToken` 대신 네이티브 APNs 토큰을 받아 `registerPushDevice({ platform: 'ios', installationId, pushToken, locale, apnsEnvironment })`를 호출한다. `apnsNotReady` 분기는 토큰을 받을 수 없을 때만 남긴다.
   - `pushDevicesApi.ts`: 요청에 `apnsEnvironment?: 'development' | 'production'` 추가.
   - `usePushMessageHandling.ts`: iOS에서는 네이티브 모듈 이벤트(포그라운드 수신, 탭, 최초 알림)를 같은 `parseSocialPushEvent`/탭 라우팅으로 연결한다.
   - 토큰 변경: 앱 실행·포그라운드 복귀·언어 변경 때 다시 등록한다(Android의 `onTokenRefresh`에 해당하는 iOS 이벤트는 없으므로 `didRegister...`가 올 때마다 등록).
   - 로그아웃·계정 전환: 기존 `pushLogoutUnregister.ts` 그대로 `DELETE /api/v1/push/devices/{installationId}`.
4. 권한 요청과 APNs 등록은 다르다: 권한(알림 표시 허용)은 `requestAuthorization`, APNs 토큰은 `registerForRemoteNotifications`. 권한이 거부돼도 토큰은 나올 수 있지만, 서버에 등록하지 않는다(Android와 같은 규칙: 권한이 granted일 때만 등록).
5. Android 회귀: iOS 분기만 바꾸고 Android 경로(FCM)는 건드리지 않는다. 변경 후 Android 실제 기기 푸시를 다시 확인한다.
6. 고칠 파일 요약: `ios/JupleMobile/AppDelegate.swift`(토큰 콜백, 알림 delegate), 새 네이티브 모듈(`.mm`/`.swift`, 기존 `JupleNotificationPermissions.mm` 옆), entitlements(Xcode Capability), `src/push/fcmPlatform.ts`를 쓰는 분기들, `pushRegistrationSync.ts`, `pushDevicesApi.ts`, `usePushMessageHandling.ts`, `usePushRegistrationSync.ts`, 관련 Jest 테스트. `project.pbxproj`는 Xcode로만 수정한다.

### 백엔드 없이 먼저 확인하는 방법

- **Simulator**: Xcode 14+/macOS 13+ (Apple silicon 또는 T2 Mac)에서는 Simulator도 sandbox 원격 알림을 받고 development 토큰을 발급한다. 알림 UI·탭 라우팅은 `xcrun simctl push booted com.juple.app payload.json`으로 위 3장의 페이로드를 그대로 넣어 확인할 수 있다(토큰·서버 불필요).
- **실기기 + Apple Push Notifications Console**(developer.apple.com > CloudKit Console > Push Notifications): .p8 키 없이 Apple 계정으로 특정 토큰에 테스트 푸시를 보낼 수 있다. 토큰과 환경이 맞는지 서버 설정 전에 확인하는 데 쓴다.

### 문제 해결 (서버 로그 EventId 7301의 reason)

| reason | 뜻 | 확인할 것 |
| --- | --- | --- |
| `BadDeviceToken` | 토큰이 그 gateway의 것이 아님 | 앱이 보낸 `apnsEnvironment`(provisioning profile 기준인지), hex 변환 |
| `DeviceTokenNotForTopic` | 다른 bundle id의 토큰 | 앱 bundle id가 `com.juple.app`인지, `Apns__BundleId` |
| `Unregistered` (410) | 앱 삭제·알림 해제로 토큰 폐기 | 정상. 재설치 후 새 토큰 등록 |
| `TopicDisallowed` | 키/팀에 그 bundle id 권한 없음 | App ID의 Push 활성화, 같은 Team의 키인지 |
| `InvalidProviderToken`, `UnrelatedKeyIdInToken` | 키·Key ID·Team ID 불일치 | `Apns__KeyId`/`Apns__TeamId`/.p8 (EventId 7304 로그와 함께 10분 차단) |
| `BadEnvironmentKeyInToken` | 키가 다른 환경 전용 | Apple Developer > Keys의 환경 제한 |
| `TooManyProviderTokenUpdates` | JWT를 너무 자주 갱신 | 여러 프로세스가 매번 재서명하는지(정상 동작은 40분 재사용) |

## 6. Backend 설정 (PROD 반영 전 필요, 아직 하지 않음)

| 설정 | 값 | 저장 위치 |
| --- | --- | --- |
| `Apns__KeyId` | .p8 Key ID (10자) | Container App env (비밀 아님) |
| `Apns__TeamId` | Team ID (10자) | Container App env (비밀 아님) |
| `Apns__PrivateKeyPem` | .p8 파일 내용(PEM, 또는 Base64 본문) | **Key Vault secret -> Container Apps secret reference** |
| `Apns__BundleId` | 기본값 `com.juple.app` | 바꿀 때만 |

- 이 설정은 푸시를 실제로 보내는 **notification worker**와 **push-dispatch Job**에 필요하다(API 인라인 처리 경로를 쓰는 경우 API에도). Firebase 서비스 계정과 같은 곳에 둔다.
- **Bicep**: `notification-worker/main.bicep`, `job/main.bicep`의 `apnsKeyId` / `apnsTeamId` / `apnsPrivateKeySecretName`(Key Vault secret **이름**, 값이 아니다). 셋 다 비어 있으면 APNs off이고 템플릿은 이전과 같은 것을 배포한다. 일부만 있거나 id가 10자가 아니거나 vault URI가 없으면 `app/apns-config-guard.bicep`가 template validation 단계에서 배포를 거절한다(시작 실패로 Android 발송까지 멈추는 일을 막기 위해). `.p8` 내용을 받는 parameter는 없다. Production 값은 각 `prod.bicepparam`(Key ID `FJKA3F5KV3`, Team ID `3N2K257SW3`, secret `apns-private-key-pem`), Dev는 비워 둔다(APNs off).
- **배포 순서(Production, 각 단계 승인 후)**: ① `AddApnsDeviceSupport`만 담은 script 적용(아래) - 새 image는 두 컬럼을 읽으므로 migration 없이 배포하면 Android 등록·발송까지 실패한다. ② Key Vault secret `apns-private-key-pem` 등록(`.p8` 파일에서 직접, 출력에 값 없음). ③ worker identity에 그 secret 하나만 읽는 role(`foundation/key-vault-secret-reader.bicep`, `readerIdentityName=id-juple-notify-worker-prod`) - push-dispatch Job은 API identity라 vault 단위 role이 이미 있다. ④ APNs backend가 들어간 image로 API -> worker -> Job 배포. 이 템플릿을 APNs 값과 함께 배포하는 시점에는 ②③이 끝나 있어야 한다.
- **image 범위**: Production에서 돌고 있는 image에는 export/retention/expense ledger 등 master의 다른 기능과 그 migration이 없다. APNs 배포 image는 master 전체가 아니라 Production image의 source 기준(`131984a` + 보안 `3b48a33` + 중복 방지 `72d1a51`)에 APNs backend(`e9f7e10`)만 더한 것이어야 한다.
- 세 값(KeyId/TeamId/PrivateKeyPem) 중 일부만 있으면 프로세스가 시작 시 실패한다(설정 이름만 출력, 키 값은 출력하지 않음). 셋 다 없으면 APNs는 꺼진 상태: iOS 발송은 `push_transport_not_configured`로 기록되고 알림 만료 전까지 재시도되며, Android는 영향이 없다.
- endpoint: production `https://api.push.apple.com`, development `https://api.sandbox.push.apple.com`. 기기마다 등록된 `apnsEnvironment`로 고른다.
- 인증: ES256 JWT(kid=Key ID, iss=Team ID), 40분 재사용(Apple 제한: 20분-60분).
- 인증 실패(403)는 기기 문제가 아니므로 **기기 토큰을 비활성화하지 않는다.**
  - `ExpiredProviderToken`: 새 JWT로 한 번만 재시도.
  - 그 밖의 403(`InvalidProviderToken`, `MissingProviderToken`, `UnrelatedKeyIdInToken`, `BadEnvironmentKeyInToken`, `Forbidden` 등) 또는 재서명 후에도 Expired: 그 gateway(production/development 각각)를 **10분 동안 차단**한다. 차단 중에는 Apple을 호출하지도, JWT를 새로 만들지도 않고 즉시 `third_party_auth_error`로 실패한다(Apple은 잦은 토큰 갱신을 429로 막는다). 10분 뒤 한 번 다시 시도한다. 로그 EventId 7304에 원인 확인 안내가 남는다.
  - 파이프라인 재시도: 실패한 iPhone 전달은 기존 정책대로 알림이 만료될 때까지(일반 6시간, data-only 10분) 복구 Job(1분 주기)이 다시 시도하고, 만료되면 종료된다. 무한 재시도는 없다. 차단 덕분에 키가 계속 잘못돼 있어도 Apple 호출은 gateway·프로세스당 10분에 한 번 수준이다.
  - 같은 알림의 Android 전달은 처음에 한 번 Sent로 기록되고 iPhone 재시도 때 다시 보내지지 않는다(전달은 알림 x 기기 단위).
- 로그: 등록 id, HTTP 상태, APNs reason, apns-id만 남긴다. 기기 토큰, JWT, 키는 남기지 않는다.

### DB migration

`20261021010225_AddApnsDeviceSupport` (push.PushDeviceRegistrations):
- `ApnsEnvironment tinyint NULL` 추가 (iOS만, Android는 NULL; CHECK 제약).
- `PushTokenHash binary(32)` persisted computed column(`CONVERT(binary(32), HASHBYTES('SHA2_256', [PushToken]))`)과 활성 행 filtered index `IX_PushDeviceRegistrations_Platform_PushTokenHash_Enabled (Platform, PushTokenHash) WHERE IsEnabled = 1` - 같은 토큰을 가진 다른 활성 등록을 찾는 데 쓴다. 키가 작고(1 + 32 bytes) 기존 인덱스 이름과 겹치지 않는다. 해시는 조회 범위를 좁히는 용도이고 비교는 `PushToken` 원문으로도 한 번 더 하므로, 해시 충돌이 있어도 다른 토큰이 비활성화되지 않는다.
- `PushToken`은 `varchar`라서 SQL 해시는 ASCII 바이트 기준이고, 앱 쪽 `PushTokenHash.Of`는 UTF-8 바이트로 같은 값을 만든다(FCM/APNs 토큰은 ASCII). 로컬 DB에서 모든 행의 저장된 해시가 `HASHBYTES` 결과와 일치함을 확인했다.
- 기존 iOS 행이 있으면 `ApnsEnvironment = 0`(production)으로 채운다(현재 iOS 등록은 없을 것으로 예상). idempotent script에서 같은 batch로 실행돼도 컴파일되도록 `EXEC`로 감쌌다.
- 추가만 하는 변경이라 이전 API revision과 함께 동작한다(이전 revision은 Android 행만 만들고, 두 컬럼을 몰라도 된다). 컬럼 추가 시 작은 테이블에 잠깐 스키마 잠금이 걸린다.

### PROD migration 적용 계획 (승인 후, 이 문서 시점에는 실행하지 않음)

PROD에서 마지막으로 적용이 확인된 migration은 `20261019060844_AddUserDailyActivities`다(Round 5 적용 기록). 저장소 기록상 그 뒤의 `20261020032254_AddDataExportLinks`, `20261020100000_FreezeDataExportImagePlan`(로컬 RET DB에만 적용, RELEASE_BACKLOG), `20261020110000_AddBusinessExpenses`(로컬 전용, permissions-pricing-business-expenses.md)는 PROD에 적용되지 않았을 가능성이 높다. 이 PC에서는 PROD에 연결하지 않았으므로 실제 상태는 확인하지 못했다.

**위험**: `infra/azure/README.md`의 기존 절차대로 `dotnet ef database update`를 실행하면 미적용 migration이 **전부** 같이 적용된다(DataExport, Expenses 테이블 포함). 이번 배포에서는 그렇게 하지 않는다.

1. 읽기 전용 확인(승인된 접근으로): `SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC`, `SELECT COUNT(*) FROM push.PushDeviceRegistrations WHERE Platform = 1`(iOS 행 수), 같은 토큰의 활성 중복 수(`GROUP BY Platform, PushToken HAVING COUNT(*) > 1`).
2. APNs만 담은 idempotent script 생성:
   `dotnet ef migrations script 20261020110000_AddBusinessExpenses 20261021010225_AddApnsDeviceSupport --idempotent --project src/Juple.Infrastructure --startup-project src/Juple.Api --output apns-only.sql`
   - 이 script에는 `AddApnsDeviceSupport` 하나만 들어 있다(로컬에서 확인). 앞의 세 migration이 PROD에 없어도 적용할 수 있다: 로컬 DB를 `AddUserDailyActivities` 상태로 되돌린 뒤 이 script만 적용해 APNs 객체만 생기고 다른 기능 테이블은 생기지 않음을, 그 뒤 `database update`로 나머지가 순서와 무관하게 적용됨을 확인했다.
3. script 검토 -> 적용(한 batch, 트랜잭션) -> history에 `AddApnsDeviceSupport`만 추가됐는지 확인 -> 그 다음 새 API/worker/Job 배포.
4. 나중에 DataExport/Expenses migration은 각자의 승인 절차로 따로 적용한다. idempotent script는 history에 있는 migration을 건너뛰므로 순서가 바뀌어도 안전하다.
5. 롤백: 이전 API revision은 새 컬럼을 몰라도 동작하므로 스키마는 그대로 두고 앱만 되돌린다. 스키마까지 되돌려야 하면 `Down`(인덱스·제약·두 컬럼 삭제)을 쓴다.

## 7. 실제 iPhone 테스트 시나리오

1. Xcode Debug 빌드(development 토큰) -> 로그인 -> 알림 허용 -> `PUT /push/devices`에 `platform: ios`, `apnsEnvironment: development`로 등록되는지 확인.
2. 다른 계정(또는 Android 기기)에서 공유 컬렉션에 링크 추가 -> iPhone 잠금 화면에 "새 링크" 배너, 탭하면 해당 컬렉션으로 이동.
3. 앱 포그라운드 상태에서 같은 동작 -> 시스템 배너 대신 앱 내 배너.
4. 같은 사용자의 Android 기기와 iPhone이 각각 한 번씩 받는지(중복 없음).
5. 로그아웃 -> 같은 이벤트 -> iPhone이 받지 않음. 다른 계정으로 로그인 -> 이전 계정 알림이 오지 않음.
6. 앱 삭제 후 재설치 -> 이전 토큰은 APNs 410으로 비활성화되고, 새 토큰으로 정상 수신.
7. TestFlight 빌드(production 토큰)로 2-6 반복.
8. 알림 끄기(컬렉션 알림 OFF)·차단한 사용자의 알림이 iPhone에도 오지 않는지 확인.

## 8. 전달 보장

- 알림 x 기기 단위 claim(`NotificationDeliveries`, 유일 키)으로 정상 경로에서는 한 번만 보낸다. 이미 Sent인 기기는 재시도 대상이 아니다.
- 정확히 한 번은 보장하지 않는다(at-least-once): APNs가 수락한 직후 결과 기록 전에 프로세스가 죽으면 claim lease 만료 뒤 한 번 더 보낼 수 있다.
- 완화: iOS는 `apns-collapse-id`가 알림 id라서 기기에서 같은 알림이 하나의 배너로 합쳐진다. Android FCM에는 같은 장치가 없다(기존 동작 그대로).
