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

Firebase 프로젝트 존재 여부도 이 저장소 기준으로는 아직 미확정이다 - 생성되었다고 가정하지
않는다(`google-services.json`/`GoogleService-Info.plist` 없음, Mobile에 FCM 관련 패키지/설정 없음).

### Push 알림 계획 (미착수 — 리소스 미생성)

Backend에 Push 알림 전송을 위한 device 등록/delivery idempotency 기반(코드)만 먼저 마련된
상태이고, 아래는 아직 리소스를 만들지 않은 **계획**이다:

- Android: FCM v1(legacy server key 아님) - Firebase 서비스 계정 credential(projectId/clientEmail/
  privateKey) 필요, Firebase 프로젝트 존재 여부부터 먼저 확인 필요.
- Azure Notification Hubs 네임스페이스/Hub 1개, **Send claim만 가진 전용 SAS Access Policy**로
  Backend가 인증(Notification Hubs data-plane SDK는 Managed Identity를 지원하지 않고 SAS 기반
  Access Policy만 지원 - Microsoft 공식 문서 기준).
- Azure Container Apps의 scheduled Job(cron)으로 기존 API 이미지를 `--run-push-dispatch` 인자로
  재사용해 주기적으로 dispatch.

실제 Hub/Job 생성, Firebase 프로젝트 생성/확인, credential 발급은 모두 별도 승인 후 진행한다.

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
