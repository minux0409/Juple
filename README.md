# Juple

Juple은 발견한 상품과 콘텐츠를 빠르게 저장하고, 나중에 검토·정리·구매 기록·반복 구매 관리까지 이어 주는 글로벌 서비스다. 단순 링크 저장이나 위시리스트를 넘어 사용자의 실제 구매 흐름을 신뢰성 있게 관리하는 것을 목표로 한다.

## 현재 상태

현재 저장소에는 React Native CLI 기반 모바일 앱과 .NET 기반 Backend, local 개발 인프라가 존재한다.

- React Native `0.87.0`
- React `19.2.3`
- TypeScript
- Android / iOS 네이티브 프로젝트 포함
- Android 기본 빌드 및 API 36 에뮬레이터 실행 확인
- Android applicationId / iOS Bundle Identifier: `com.juple.app`
- Backend: .NET 10 / ASP.NET Core / EF Core (Modular Monolith)
- Local 개발 인프라: SQL Server, Azurite(Blob Storage emulator) — `infra/local/compose.yaml`
- Azure production 인프라는 아직 구성되지 않음
- Web은 아직 구현되지 않음

Juple은 Google Play Store, Apple App Store, Web 출시와 장기 운영을 전제로 하는 Production-oriented 프로젝트다.

## Technology Overview

| 영역         | 기술                                                 |
| ------------ | ---------------------------------------------------- |
| Mobile       | React Native CLI, TypeScript                         |
| Web          | Next.js, TypeScript (예정)                           |
| Backend      | .NET 10 LTS, ASP.NET Core Web API, EF Core 10         |
| Architecture | Modular Monolith                                      |
| Database     | Azure SQL Database (예정, local dev는 SQL Server)     |
| Cloud        | Microsoft Azure (예정)                               |
| Push         | FCM, APNs, Azure Notification Hubs (예정)            |

## Repository Structure

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

## Backend 로컬 실행

### Public Collection Sharing cursor encryption key

Public Collection Sharing의 공유 페이지(`/c/[publicId]`) pagination cursor는 AES-256-GCM으로 암호화된다. Backend는 시작 시 `PublicCollectionCursor:EncryptionKey` 설정(Base64로 인코딩된 32바이트 키)이 없거나 32바이트로 decode되지 않으면 의도적으로 startup을 실패시킨다 — 이 값을 설정하지 않은 새 PC/새 checkout에서 Backend가 뜨지 않는 것은 예상된 동작이다.

- 실제 key 값은 어떤 형태로도 이 repository에 commit하지 않는다.
- Local Development: Backend(`backend/src/Juple.Api`, `UserSecretsId: juple-api-local-development`)의 `dotnet user-secrets`에 개별적으로 저장한다.
- Production: 소스에 두지 않고 환경변수 또는 secret provider(예: Azure Key Vault)로 주입한다 — 이 구성은 Stage 2/Azure 배포 단계에서 처리한다.

PowerShell에서 cryptographically random 32바이트 키를 생성해 화면에 출력하지 않고 곧바로 user-secrets에 저장한다.

```powershell
cd backend/src/Juple.Api
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
dotnet user-secrets set "PublicCollectionCursor:EncryptionKey" ([Convert]::ToBase64String($bytes))
Remove-Variable bytes
```

## Mobile 실행

에뮬레이터 또는 디바이스를 준비한 뒤 모바일 프로젝트에서 Metro를 실행한다.

```powershell
cd apps/mobile
npm install
npm start
```

새 터미널에서 Android 앱을 빌드하고 실행한다.

```powershell
cd apps/mobile
npm run android
```

현재 개발용 Android AVD 이름은 `Juple_Pixel_API36`이다. iOS 빌드와 배포는 Mac + Xcode 환경에서 수행한다.

### iOS Universal Links (아직 비활성 상태)

`apps/mobile/ios/JupleMobile/JupleMobile.entitlements` 파일은 Public Collection Sharing 공유 링크(`https://<domain>/c/{publicId}`)를 위한 Associated Domains 항목을 담고 있지만, **아직 `JupleMobile.xcodeproj`에 연결되지 않았다** - `CODE_SIGN_ENTITLEMENTS` build setting도, 프로젝트의 PBXFileReference/PBXGroup 항목도 없다. 즉 이 파일이 repo에 존재한다고 해서 Universal Links가 실제로 동작하는 것은 아니다. Mac/Xcode가 없는 환경에서 `project.pbxproj`를 직접 손으로 수정하면 검증 불가능한 상태로 Xcode 프로젝트를 손상시킬 위험이 있어, 의도적으로 pbxproj는 건드리지 않았다.

실제로 활성화하려면 Mac에서:

1. `JupleMobile.xcodeproj`를 Xcode로 연다.
2. Signing & Capabilities 탭 → **+ Capability** → **Associated Domains** 추가.
3. Xcode가 자동 생성하는 `.entitlements`가 이 파일을 대체하거나, 이 파일을 그대로 가리키도록 연결한다 - 어느 쪽이든 최종적으로 `applinks:<실제 production domain>` 항목이 들어 있는지 확인한다 (현재 파일의 `app-links-host-not-configured.invalid`는 RFC 2606 예약 도메인 placeholder일 뿐, 실제 도메인이 아니다).
4. Apple Developer Team ID/실제 domain은 이 문서 작성 시점에 확인되지 않았으므로 추측하지 않는다 - 실제 값이 정해지면 Android의 `JUPLE_PUBLIC_WEB_HOST`(`android/app/build.gradle`, `src/config/publicWebConfig.ts`) 및 Backend의 `PublicWeb:BaseUrl`과 동일한 도메인으로 맞춘다.

### Android에서 로컬 Backend 연결

Mobile 개발용 API 주소는 `http://localhost:5092`로 고정되어 있으며, Android emulator와 physical device 모두 다음 명령으로 PC의 Backend에 연결한다.

```powershell
adb reverse tcp:5092 tcp:5092
adb reverse --list
```

`10.0.2.2`(emulator 전용 host alias)에 의존하지 않는 이유는 physical device에서는 사용할 수 없기 때문이다. 이 port forwarding은 device/emulator가 PC와 연결된 동안만 유지되는 development 전용 설정이며, device 재연결·emulator 재시작·adb server 재시작·PC 재시작 후에는 다시 실행해야 할 수 있다.

### Android에서 로컬 Item 이미지(Azurite) 조회

Item 이미지의 `readUrl`은 Backend가 구성된 local Azurite 엔드포인트(기본 `http://127.0.0.1:10000`)를 그대로 반환한다. 코드로 이 host를 변조하지 않으며, 5092 포트와 동일한 방식으로 처리한다.

```powershell
adb reverse tcp:10000 tcp:10000
adb reverse --list
```

## Documentation

- [Product Overview](docs/product-overview.md)
- [Architecture](docs/architecture.md)
- [Development Principles](docs/development-principles.md)
- [Copilot Instructions](.github/copilot-instructions.md)
