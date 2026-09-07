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

Azure Dev 환경(`rg-juple-dev`)에는 Foundation과 App 두 단계가 **모두 이미 배포되어 있다**:
User Assigned Managed Identity, Azure Container Registry, Storage Account, Azure SQL 논리
서버/Database, Log Analytics Workspace, Container Apps Environment, 그리고 Container App
`ca-juple-api-dev`(scale-to-zero, `minReplicas=0`)까지 실제로 존재하고 "Succeeded" 상태다.

**현재 배포된 revision(`78603b3`)은 master(`dbec30c`) 대비 14 commit 뒤처져 있고, `app/main.bicep`이
요구하는 `publicCollectionCursorEncryptionKey` secret이 아직 Container App에 없다** — 이 상태로 최신
이미지를 그대로 재배포하면 API가 startup에서 즉시 실패한다(`PublicCollectionCursorOptions`의 fail-fast,
아래 "Push 알림" 섹션과 "Migration + API 배포 순서" 참고). 다음 배포는 이 secret 추가 + 6개 pending
migration 적용 + 새 이미지 배포가 한 세트로 묶여야 한다.

아래 명령 예시는 재배포/업데이트 시 참고용이며, "아직 실행하지 않음"이 아니다 — 실제 값/시크릿은
예시에 포함하지 않는다.

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

# 3. App (resource group scope)
# sqlConnectionString은 기존과 동일하게 환경변수로 전달한다 - 이미 검증된 방식이라 바꾸지 않는다.
# publicCollectionCursorEncryptionKey는 @<file> 문법으로 전달한다 - repo 밖 임시 파일에 32바이트
# key의 Base64 문자열만 담아두고, 명령줄/셸 히스토리에는 파일 경로만 남긴다(내용은 노출되지 않음).
az deployment group create `
  --resource-group $foundation.resourceGroupName.value `
  --template-file infra/azure/app/main.bicep `
  --parameters `
    acrLoginServer=$foundation.acrLoginServer.value `
    imageTag=<tag> `
    containerAppsEnvironmentId=$foundation.containerAppsEnvironmentId.value `
    managedIdentityResourceId=$foundation.managedIdentityResourceId.value `
    managedIdentityClientId=$foundation.managedIdentityClientId.value `
    storageBlobServiceUri=$foundation.storageBlobServiceUri.value `
    sqlConnectionString=$env:SQL_CONNECTION_STRING `
    publicCollectionCursorEncryptionKey=@<repo 밖 임시 파일 경로 - 32바이트 key의 Base64 한 줄>

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

이 세션 시점 기준 repo에는 18개 migration이 있고, 배포된 이미지(`78603b3`)의 assembly에는
`AddCollections`까지 12개만 포함되어 있어 **다음 6개가 미적용으로 추정된다**(실제 SELECT 결과로
반드시 재확인 - assembly에 포함되어 있다는 것이 실제로 적용됐다는 증거는 아니다):

1. `AddCollectionFavorite`
2. `AddCollectionShares`
3. `AddRecentlyOpenedItems`
4. `RemoveItemStateAndCategory` — schema-breaking(Items.State/CategoryId 컬럼 drop), Wishlist/
   Archive/Category를 Collections로 변환하는 Up() 데이터 이관 포함. 실행 전 마지막으로
   Azure의 실제 Items/Categories/Collections/CollectionItems 행 수를 다시 스냅샷하고, 이 마이그레이션의
   Up() 로직(같은 이름 Collection 재사용, State→Wishlist/Archive Collection 이관, Category→동명
   Collection 이관)이 그 스냅샷을 무손실로 보존하는지 재확인한 뒤에만 진행한다.
5. `AddNotifications`
6. `AddPushNotificationDelivery`

SELECT 결과가 위 목록과 다르면(즉 이 6개 중 일부가 이미 적용되어 있거나, 예상 밖의 상태라면)
`dotnet ef database update`를 실행하지 않고 원인을 먼저 파악한다.

### Migration + API 배포 순서 (maintenance window)

`RemoveItemStateAndCategory`가 schema-breaking이므로, migration과 API revision 배포 사이에
새 스키마와 호환되지 않는 옛 이미지가 트래픽을 받는 짧은 구간이 생기지 않도록 순서를 지킨다.
Pre-production(Mobile 실사용자 없음) 환경이므로 별도의 하위호환 migration은 만들지 않는다 -
대신 짧은 Dev maintenance window로 처리한다:

1. 최신 이미지(`dbec30c` 기준) build & push 완료
2. App/Job Bicep에 필요한 모든 secret/parameter 입력값 준비 완료(값 자체는 미리 Azure에 보내지 않음)
3. Migration 실행 직전 최종 readiness 확인(위 SELECT + 스냅샷 재확인)
4. 6개 migration 적용 (`dotnet ef database update`)
5. **성공 즉시** 최신 이미지로 App revision 배포 — 성공과 배포 사이에 다른 작업을 끼우지 않는다
6. API `/health` 확인
7. Push dispatch Job 배포
8. SQL 임시 방화벽 규칙 제거

**Migration 실패 시**: 새 API 배포를 진행하지 않고 원인을 먼저 조사한다.
**API 배포 실패 시**: migration이 이미 schema-breaking일 수 있으므로 `Down()`으로 되돌리려 하지
않는다 - 대신 최신 API 배포 자체의 문제를 즉시 복구하는 방향으로 대응한다(스키마는 이미 새
버전이 맞다는 전제 위에서 문제를 해결한다).

### 정리 대상: ad-hoc 방화벽 규칙

현재 SQL Server에 `QueryEditorClientIPAddress_...`로 시작하는 규칙이 IaC 밖에서(Azure Portal의
Query Editor 사용 중) 추가돼 남아있다. 이 문서의 임시 규칙 add/delete 절차와 달리 자동으로
정리되지 않으므로, 다음 실제 배포 라운드에서 현재도 필요한지 확인 후 불필요하면 제거한다
(`az sql server firewall-rule delete`). Foundation Bicep이 관리하는 `AllowAzureServices` 규칙과는
무관하다.

## 아직 provisioning되지 않은 것

다음은 구독에 실제로 존재하지 않는다(subscription-wide 조회로 확인) — **not provisioned yet**:
Key Vault, Application Insights, Service Bus, Notification Hubs, VNet, Private Endpoint, custom
domain, Staging/Production 실제 리소스, GitHub Actions 워크플로, Container Apps의 scheduled Job
리소스 자체(**IaC는 `job/main.bicep`으로 이미 준비돼 있다** - 아래 "Push 알림" 참고, 아직 배포만
안 됐다는 뜻).
이유와 재검토 시점은 세션 히스토리의 Azure 조사 보고(2026-09-03) 참고.

Firebase 프로젝트(`juple-9fa62`)와 Mobile의 `google-services.json`은 이미 존재한다(Push Stage
2B-1 - Android FCM device registration 연결). Backend의 실제 FCM v1 전송(Push Stage 2B-2)은
Azure Notification Hubs를 사용하지 않기로 확정하고 FCM v1에 Firebase Admin SDK로 직접 전송하는
방식으로 local Backend까지 구현·검증되었다(아래 "Push 알림" 참고). 이 섹션 자체는 Azure 리소스
관점에서 여전히 미착수 상태를 기술한다.

### Push 알림 - 코드/IaC 준비 완료, Azure 리소스 미생성

Backend에 Push 알림 전송을 위한 device 등록/delivery idempotency/실제 FCM v1 전송(코드)까지
마련되어 local Backend + `--run-push-dispatch`로 실기기 E2E까지 검증되었고, `infra/azure/job/main.bicep`으로
Container Apps scheduled Job의 IaC도 준비됐다. 아래는 **아직 Azure 리소스로 배포하지 않은** 상태다:

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

실제 Job 생성, Azure 환경의 Firebase credential(Container Apps Job secret) 설정은 모두 별도 승인
후 진행한다.

**배포 후 E2E fixture 준비**: 실제 DB INSERT로 RepeatPurchase를 직접 만들지 않고, 가능한 한 정상
API/Mobile UX(로그인 → RepeatPurchase 생성 → PushDeviceRegistration은 앱의 정상 등록 흐름)로
fixture를 준비한다. Due 시점을 앞당기는 것과 같이 UX로 불가능한 조작만 최소한으로 직접 SQL을
쓴다. raw FCM token은 어떤 로그/출력에도 남기지 않는다.

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
| Container Apps Job | `caj-juple-push-dispatch-{environmentName}` | Push dispatch 전용, API와 별개 secret 네임스페이스 |

`environmentName`은 모든 템플릿에서 parameter이므로(현재는 `dev`만 허용), 향후 Staging/Production
도 같은 템플릿을 재사용해 생성할 수 있다.
