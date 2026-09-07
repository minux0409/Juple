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
`ca-juple-api-dev`(scale-to-zero, `minReplicas=0`)까지 실제로 존재하고 "Succeeded" 상태다. 아래
명령 예시는 재배포/업데이트 시 참고용이며, "아직 실행하지 않음"이 아니다 — 실제 값/시크릿은
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

# 2. 이미지 빌드 & push
az acr login --name $foundation.acrName.value
docker build -f backend/src/Juple.Api/Dockerfile -t "$($foundation.acrLoginServer.value)/juple-api:<tag>" backend/
docker push "$($foundation.acrLoginServer.value)/juple-api:<tag>"

# 3. App (resource group scope)
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
    sqlConnectionString=$env:SQL_CONNECTION_STRING
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
# ... dotnet ef database update 실행 ...
az sql server firewall-rule delete --resource-group <rg> --server <sqlServerName> --name "TemporaryDevMachine"
```

## 아직 provisioning되지 않은 것

다음은 구독에 실제로 존재하지 않는다(subscription-wide 조회로 확인) — **not provisioned yet**:
Key Vault, Application Insights, Service Bus, Notification Hubs, VNet, Private Endpoint, custom
domain, Staging/Production 실제 리소스, GitHub Actions 워크플로, Container Apps의 scheduled Job.
이유와 재검토 시점은 세션 히스토리의 Azure 조사 보고(2026-09-03) 참고.

Firebase 프로젝트(`juple-9fa62`)와 Mobile의 `google-services.json`은 이미 존재한다(Push Stage
2B-1 - Android FCM device registration 연결). Backend의 실제 FCM v1 전송(Push Stage 2B-2)은
Azure Notification Hubs를 사용하지 않기로 확정하고 FCM v1에 Firebase Admin SDK로 직접 전송하는
방식으로 local Backend까지 구현·검증되었다(아래 "Push 알림 - local 구현 완료, Azure 리소스 미생성"
참고). 이 섹션 자체는 Azure 리소스 관점에서 여전히 미착수 상태를 기술한다.

### Push 알림 - local 구현 완료, Azure 리소스 미생성

Backend에 Push 알림 전송을 위한 device 등록/delivery idempotency/실제 FCM v1 전송(코드)까지
마련되어 local Backend + `--run-push-dispatch`로 검증되었고, 아래는 아직 Azure 리소스를 만들지
않은 **계획**이다:

- Android: FCM v1(legacy server key 아님) - Firebase 서비스 계정 JSON credential이 필요하며,
  Backend는 이를 `Firebase:ServiceAccountKeyJson` 설정(local: `dotnet user-secrets`, Azure:
  Container Apps secret)으로 읽는다. Mobile의 `google-services.json`(client 설정, 비밀 아님)과는
  완전히 별개다.
- iOS: APNs 직접 전송 예정(아직 구현되지 않음).
- Azure Notification Hubs는 사용하지 않기로 확정했다 - data-plane SDK가 SAS Access Policy만
  지원해 Managed Identity 인증과 맞지 않고, FCM/APNs를 이미 직접 사용하는 구조에서 추가 계층이
  될 필요가 없다는 판단.
- Azure Container Apps의 scheduled Job(cron)으로 기존 API 이미지를 `--run-push-dispatch` 인자로
  재사용해 주기적으로 dispatch할 계획이다(아직 Job 리소스 미생성).

실제 Job 생성, Azure 환경의 Firebase credential(Container Apps secret) 설정은 모두 별도 승인
후 진행한다.

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

`environmentName`은 모든 템플릿에서 parameter이므로(현재는 `dev`만 허용), 향후 Staging/Production
도 같은 템플릿을 재사용해 생성할 수 있다.
