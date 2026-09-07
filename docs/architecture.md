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

Push dispatch는 Azure Container Apps의 scheduled Job(cron)으로 기존 API 이미지를 `--run-push-dispatch` 인자로 재사용해 주기적으로 실행할 계획이다(아직 Azure Job 리소스는 생성되지 않았다 - `infra/azure/README.md` 참고).

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
