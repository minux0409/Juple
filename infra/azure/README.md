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
# live 값(acrLoginServer 등)은 readEnvironmentVariable(...)로 읽고, secret 2개
# (sqlConnectionString/publicCollectionCursorEncryptionKey)도 .bicepparam 사용 시
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

**`androidAssetlinksSha256Fingerprints`는 실값이 있다** - Android App Links Dev E2E 검증을 위해
`ca-juple-web-dev`에 CLI로 직접 값이 설정되어(이 Bicep 배포를 거치지 않고) 이미 PASS했다(위
"아직 provisioning되지 않은 것" 참고). 어떤 keystore의 fingerprint인지는 이 repo에 기록되어
있지 않다 - 확인 없이 추측하지 않는다(Dogfood keystore의 fingerprint와는 다른 값이다 - 위
"Dogfood signing" 섹션의 keystore와 혼동하지 않는다). `dev.bicepparam`이 이 값을 literal로
고정해 재배포로 유실되지 않게 한다 - 아래 "Web custom domain" 섹션의 `dev.bicepparam` 구성
참고.

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
