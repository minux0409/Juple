# Azure 비용 수집 전용 Job

2026-10-22 운영 설정을 기록한 **독립 Job**이다. 이 파일의 추가나 검증 스크립트 실행은 배포하지 않는다.
기존 Push/Billing/Retention Job, API/Admin 이미지, DB, Key Vault, 권한을 변경하지 않는다.

## 운영 기준

| 설정 | 값 |
| --- | --- |
| Subscription / RG | `37402353-9fc3-4fd7-bc9a-d5d2197b6b6b` / `rg-juple-prod` |
| Job | `caj-juple-azure-cost-sync-prod` |
| 이미지 | `acrjupleprody5v2isrk3zbwu.azurecr.io/juple-api@sha256:0f42c0d3fe353a9ad73f0522ee7e491e74b1327057ffb0e4bd48b3f2d596897c` |
| 실행 | 이미지 ENTRYPOINT `dotnet Juple.Api.dll` + `--run-azure-cost-sync`; command override 없음 |
| 일정 | `10 2 * * *` UTC, 매일 한국 시간 11:10 |
| 실행 제한 | 1 replica / 완료 1개, 최대 1,200초, 즉시 재시도 0회 |
| 자원 | Consumption, 0.25 vCPU / 0.5 GiB |
| 기존 UAMI | `id-juple-prod`, client `aa1e7146-09da-4055-b890-3e85e9a5f914` |
| SQL | `ConnectionStrings__JupleDatabase` → `sql-connection-string` → 기존 Key Vault `sql-runtime-connection-string` 참조 |

`prod.bicepparam`에는 공개 가능한 리소스 식별자와 고정 digest만 있다. 비밀번호, 연결 문자열 값,
토큰, APNs/FCM 키는 없다. 다른 운영 이미지의 환경변수를 통째로 복사하지 않는다.

환경변수 전체 목록은 `main.bicep`에 있다. 주요 설정:

- `ASPNETCORE_ENVIRONMENT=Production`, `AZURE_CLIENT_ID=<위 UAMI client ID>`
- `Expenses__Enabled=true`, `Expenses__AzureSyncEnabled=true`
- `Expenses__AzureScopes__0__Scope=/subscriptions/37402353-9fc3-4fd7-bc9a-d5d2197b6b6b/resourceGroups/rg-juple-prod`
- `Expenses__AzureScopes__0__Environment=PROD`, `Expenses__AzureScopes__0__AllowWholeSubscription=false`
- `Logging__LogLevel__Default=Warning`, `Logging__LogLevel__Microsoft=Warning`

Job에는 `Expenses__AzureInsightsEnabled`가 필요 없다. API의 수동 동기화/리소스 분석 설정은 별개다.
현재 운영 API에는 `Expenses__Enabled`, `Expenses__AzureSyncEnabled`, `Expenses__AzureInsightsEnabled`가
모두 true이고 같은 RG allowlist가 설정돼 있다. 이 Job 템플릿은 API 설정을 관리하지 않는다.

## 기존 권한과 저장 권한

UAMI principal: `5beb68bf-0683-44bb-ad49-9329ca286af3`.

- 기존 Cost Management Reader role definition: `72fafb9e-0641-4937-9268-a91bfd8191a3`.
- 정확한 scope: 위 **`rg-juple-prod` 하나**.
- 기존 assignment: `71ad58f1-1be1-4a48-adda-192b8186a201`.
- 템플릿은 RBAC를 만들거나 확대하지 않는다. 검증 도구가 기존 assignment의 principal/role/scope를 확인한다.
- 기존 AcrPull, SQL Key Vault 참조 읽기 권한은 재사용한다. 새로운 client secret/Owner/Contributor는 필요 없다.
- DB 저장은 기존 runtime SQL 계정의 비용 원장/lease/audit DML 권한으로 수행한다. Cost Management Reader는
  DB 권한을 주지 않는다. 신규 Migration이나 SQL 관리자 자격증명은 필요 없다.

DEV, 전체 Subscription, 별도 `rg-juple-prod-identity`는 수집하지 않는다. 후자는 이전 자동 승인 검토에서
범위 확대가 차단됐으며 추가 권한을 부여하지 않았다. RG에 귀속되지 않는 지원/청구 항목이나 External ID
비용은 누락 가능성이 있다. RG 비용에는 삭제된 리소스의 과거 비용도 포함될 수 있다.

## 실행 코드와 이미지 재현 범위

`backend/src/Juple.Api/Program.cs`의 `isAzureCostSyncJob`와 전용 블록은 실제 배포 소스에서 가져왔다.
이 블록은 이전/현재 UTC 청구 월을 `ExpenseSyncService.SyncAsync(null, ...)`로 동기화한다.
정확한 RG 하나만 허용하고, 일반 `--run-expense-sync`의 반복비용 생성/증빙 정리를 호출하지 않는다.
기존 DB lease, 동일 scope/date/service/currency 키의 upsert, 정정/audit 정책을 그대로 사용한다.
SIGTERM 또는 20분 만료 시 취소하며 실패 로그에는 안전한 코드만 남긴다.

`production.provenance.json`에 운영 entry-point 블록의 LF-normalized SHA-256, 소스 archive hash,
SDK/runtime digest와 실행 명령을 보존했다. 검증 도구가 Git의 블록이 이 checksum과 같은지 확인한다.

**재배포 재현:** 현재 immutable ACR digest와 `prod.bicepparam`으로 같은 Job 구성을 재현할 수 있다.
**코드 재현:** master에 동일한 실행 코드가 포함된다. 다만 운영 이미지는 선택적 백포트 소스로 빌드됐으므로
master 전체 빌드를 현재 운영 이미지와 동일하다고 주장하지 않는다. 기존 API 이미지에 이 Job 이미지를 쓰지 않는다.

현재 이미지의 정확한 빌드 입력은 아래 보존 archive다. Git에는 임시 ZIP/바이너리/obj 산출물을 넣지 않는다.

```text
C:\Users\IT\Juple\DeploymentCandidates\azure-cost-sync-prod-20261022-155544\azure-cost-job-source.zip
SHA-256 d3ddb947a8e53dc635d9a9dbb1cb674415027d15812f4eb8d4853498de605c34
```

같은 디렉터리의 `Dockerfile.prod-pinned`와 archive의 `backend/` context를 사용하고, provenance에 기록한
SDK/runtime digest를 유지한다. 기존 이미지/태그를 덮어쓰지 않는다. 재빌드는 새 고유 태그로 테스트·비교한 후
별도 승인을 받아야 한다. archive가 없는 PC는 ACR digest로 동일 배포를 재현할 수 있지만 동일 빌드 입력을
확보했다고 간주하지 않는다.

## 변경 없는 검증

PowerShell 7.2+, 기존 Bicep CLI와 Azure CLI를 사용한다. `Test-Configuration.ps1`에는 Azure 쓰기 명령이 없다.
생성 JSON은 기본적으로 OS 임시 디렉터리에 저장되며 Git에 넣지 않는다.

```powershell
# Build/lint/PROD parameter compilation + deployed entry-point checksum (offline)
./infra/azure/azure-cost-sync-job/Test-Configuration.ps1

# 같은 검사 + 실제 Job/RBAC GET/조회 및 모든 관리 필드 비교 (read-only)
./infra/azure/azure-cost-sync-job/Test-Configuration.ps1 -CheckProd

# 보존된 Job GET 결과를 대상으로 비교 (Azure 호출 없음)
./infra/azure/azure-cost-sync-job/Test-Configuration.ps1 -SnapshotPath C:/path/job.json

# 가짜 snapshot 8종으로 기본값 동등성 및 실제 drift 차단 검증 (Azure 호출 없음)
./infra/azure/azure-cost-sync-job/Test-Configuration.Tests.ps1
```

비교는 컴파일된 ARM template/parameters를 제한된 순수 표현식으로 해석한다(임의 코드 실행 없음).
환경변수 전체, Secret 참조, Identity, registry, image, args/command, CPU/Memory, timeout/retry/cron,
workload와 tags를 비교한다. 알려진 서버 메타데이터, 지역 이름의 공백/대소문자, null/생략된 optional 필드,
생략된 이미지 discriminator와 `ContainerImage` 기본값만 정규화한다. `CloudBuild`, 비어 있지 않은 추가 설정,
미확인 필드는 무시하지 않고 불일치로 처리한다. Secret 값은 출력/비교/저장하지 않는다.

실제 deployment `what-if/create`, Job start/update, DB 조회/변경은 이 검사에 포함하지 않는다.

## 운영 확인과 복구

최초 검증 실행 `caj-juple-azure-cost-sync-prod-9o3fncd`는 2026-10-22 16:24:09~16:24:52 KST에
Succeeded였다. 전월/당월 성공 표식과 관리자 원장 이력을 확인했다. 다음 예약 실행을 이미 검증한 것으로
기록하지 않는다. 포털/CLI execution 상태와 관리자 동기화 이력의 마지막 성공·실패 코드를 확인한다.

실패 시 기존 정상 스냅샷과 수동 원장은 보존된다. 자동 수집만 중단하려면 별도 운영 승인 후 **이 Job만**
`triggerType=Manual`, `azureSyncEnabled=false`로 전환한다. 실행 중인 작업은 bounded 종료를 확인한다.
API 수동 동기화도 막아야 한다면 API의 `Expenses__AzureSyncEnabled`만 별도로 false로 바꾼다.
원장/감사 이력 삭제, Queue purge, 기존 Job 변경, Migration Down은 하지 않는다.

실행 비용은 Consumption 시간 과금이며 상시 replica는 없다. 43초/일이면 월 약 US$0.01,
매번 1,200초이면 31일 약 US$0.28(컴퓨트만, 무료 할당/세금/로그/ACR/전송료 별도)이다.
Cost Management ActualCost/PreTaxCost는 최종 청구액이 아니며 세금·크레딧은 청구서와 대사한다.

- [Cost Management 범위](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/understand-work-scopes)
- [Container Apps Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [과금](https://learn.microsoft.com/en-us/azure/container-apps/billing)
