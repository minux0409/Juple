# Juple

Juple은 발견한 URL과 콘텐츠를 빠르게 저장하고, Home/History로 다시 검토하고, Collections로 정리한 뒤 나중에 다시 찾아보거나 공유하는 글로벌 URL 라이브러리 서비스다. 실제 구매 기록·반복 구매 관리는 필요한 사용자를 위한 선택적 보조 기능으로 제공한다.

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

### Dogfood signing

`assembleDogfood`(PC/Metro 없이 기기에서 단독 실행되는 dogfooding 빌드, Azure Dev Backend와 통신 - `src/api/apiConfig.ts` 참고)는 **전용 고정 signing identity**를 사용한다. 예전에는 다른 buildType과 마찬가지로 `apps/mobile/android/app/debug.keystore`(머신별로 생성되고 `.gitignore`의 `*.keystore` 규칙으로 커밋되지 않는 파일)를 사용했는데, 이 때문에 PC마다 다른 인증서로 서명된 dogfood APK가 만들어져 한 PC에서 만든 APK를 다른 PC에서 만든 것 위에 업데이트 설치할 수 없는 문제(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`)가 있었다.

**중요**:
- 이 signing identity는 Dogfood 전용이다. Production release(`assembleRelease`)는 여전히 별개이며 Play App Signing과는 아무 관계가 없다 - 절대 혼용하지 않는다.
- 실제 keystore 파일과 password는 어떤 형태로도 이 repository에 commit하지 않는다.
- `android/app/build.gradle`은 `android/app/dogfood-signing.local.properties`(gitignored)를 읽고, 없으면 동일한 이름의 환경변수로 fallback한다:
  ```
  JUPLE_DOGFOOD_STORE_FILE=<keystore 파일의 절대 경로>
  JUPLE_DOGFOOD_STORE_PASSWORD=<store password>
  JUPLE_DOGFOOD_KEY_ALIAS=<key alias>
  JUPLE_DOGFOOD_KEY_PASSWORD=<key password>
  ```
- 이 설정이 없거나 불완전하면 `assembleDogfood`는 `packageDogfood` 단계에서 명확한 signing 오류로 fail한다 - 조용히 `debug.keystore`로 fallback하지 않는다(예전 문제의 재발 방지). `assembleDebug`/`assembleRelease`는 이 설정과 무관하게 항상 그대로 동작한다.
- keystore 파일 자체는 repo 밖(예: `%USERPROFILE%\.android\`)에 보관한다.
- **새 PC(회사/집 등)에서 dogfood 빌드를 하려면**: 기존에 생성해 둔 keystore 파일과 `dogfood-signing.local.properties`(또는 동일한 4개 환경변수)를 안전한 방법으로 그 PC에 복사해야 한다 - 각 PC가 서로 다른 keystore를 새로 생성하면 이 문제가 다시 발생한다. 모든 PC가 동일한 keystore/certificate를 사용해야 서로 만든 dogfood APK끼리 update install이 가능하다.

### Production release signing (아직 실제 keystore 없음 - 구조만 준비됨)

`assembleRelease`의 signing 구조는 이제 Dogfood와 같은 패턴(gitignored local properties 파일 → 환경변수 fallback → 미설정 시 명확한 fail)을 따른다. **다만 실제 Production keystore/Play Console 등록은 아직 되어 있지 않다** - 이 섹션은 구조 설명이며, "지금 바로 Release 빌드가 가능하다"는 뜻이 아니다. Production API(`JUPLE_API_BASE_URL`)와 Production Firebase(`android/app/src/release/google-services.json`)도 여전히 없어서, signing이 준비되어도 `assembleRelease`는 그 두 가지에서 먼저 fail한다(각각 `metro.release.config.js`, Google Services Gradle 플러그인의 기존 동작 - 이번 변경과 무관하게 이미 있던 fail-fast다).

**Google Play App Signing을 사용한다** - 이것이 Play Console의 기본/권장 방식이고, 로컬에는 최종 서명 key를 전혀 보관하지 않아도 된다:

- 로컬/CI가 들고 있는 keystore는 **upload key**일 뿐이다. `./gradlew bundleRelease`/`assembleRelease`로 만든 AAB/APK는 이 upload key로 서명되어 Play Console에 업로드되고, Play가 그 아티팩트를 검증한 뒤 **별도로 자신이 보관한 App Signing key로 다시 서명해서** 실제 사용자에게 배포한다.
- 즉 로컬/CI는 upload key만 가지고 있으면 되고, 최종 배포 서명 key(App Signing key)는 Google이 보관한다 - 이 repo/PC/CI 어디에도 App Signing key 자체가 존재할 필요가 없다.
- Upload key가 분실/유출되어도 Play Console에서 key reset을 요청할 수 있다(App Signing key는 그대로 유지) - keystore를 영구히 잃어버리면 앱을 영영 업데이트할 수 없었던 예전 방식보다 안전하다.

**구조** (`android/app/build.gradle`, Dogfood와 동일한 패턴):

- `android/app/build.gradle`은 `android/app/release-signing.local.properties`(gitignored)를 읽고, 없으면 동일한 이름의 환경변수로 fallback한다:
  ```
  JUPLE_RELEASE_STORE_FILE=<upload keystore 파일의 절대 경로>
  JUPLE_RELEASE_STORE_PASSWORD=<store password>
  JUPLE_RELEASE_KEY_ALIAS=<key alias>
  JUPLE_RELEASE_KEY_PASSWORD=<key password>
  ```
- 이 설정이 없거나 불완전하면 `assembleRelease`/`bundleRelease`는 명확한 signing 오류로 fail한다 - 조용히 `debug.keystore`로 fallback하지 않는다. 이 fail-fast는 AGP의 기본 동작에만 기대지 않고 `android/app/build.gradle`의 별도 `verifyReleaseSigning` task가 명시적으로 강제한다 - 처음엔 AGP가 자동 생성하는 `validateSigningRelease` task 하나로 충분할 것으로 가정했지만, 4개 값이 전부 비어 있는 상태로 직접 실행해보니 AGP가 그 task 자체를 아예 생성하지 않는다는 걸 확인했다(즉 그 상태만으로는 signing 누락이 명시적으로 fail하지 않을 수 있었다). `verifyReleaseSigning`은 `release`의 `preReleaseBuild` lifecycle task에 `dependsOn`으로 연결되어 있어 - Debug/Dogfood는 각자의 `preDebugBuild`/`preDogfoodBuild`를 쓰므로 이 task와 무관하다 - release 계열 task가 실제로 실행될 때마다 항상 실행되며, 값이 하나라도 없으면 어떤 값이 빠졌는지(비밀번호 값 자체는 절대 출력하지 않고 필드 이름만) `GradleException`으로 명확히 알려주고, 4개 값이 모두 있어도 store file이 실제로 없으면 별도로 그 사실을 알려준다. 검사는 전부 task 실행 시점(`doLast`)에서만 일어나므로 Gradle sync나 `assembleDebug`/`assembleDogfood`처럼 이 task를 타지 않는 경로는 credential 미설정 상태에서도 항상 정상 동작한다. 실제로 확인된 동작(모두 이번 변경 검증 과정에서 직접 실행해 확인, Production keystore는 생성하지 않고 nonexistent 경로로만 테스트함):
  - 4개 값이 전부 비어 있으면 `verifyReleaseSigning`이 4개 필드 이름을 모두 나열하며 fail한다.
  - 일부만 비어 있으면 그 빠진 필드만 정확히 나열하며 fail한다.
  - 4개 값을 모두 채우되 keystore 파일이 실제로 없으면(오타/잘못된 경로 등) `verifyReleaseSigning`이 그 경로를 알려주며 fail한다: `Production release signing keystore not found at '<path>' ...`.
  - 어느 경우든 `signingConfig signingConfigs.debug`로 조용히 되돌아가는 경로는 없다 - 이전 상태(`release`가 `signingConfigs.debug`를 직접 참조하던 코드)가 바로 이 문제였고, 이번 변경으로 제거되었다.
- Upload keystore 파일 자체는 repo 밖에 보관한다(Dogfood keystore와 마찬가지). Password를 소스/커밋에 하드코딩하지 않는다.
- CI에서 사용할 경우 4개 값은 CI의 secret store(예: GitHub Actions secrets)에 저장하고, 빌드 시점에 파일 생성 없이 바로 환경변수로 주입하는 방식을 우선 검토한다 - CI 구성 자체는 아직 없다(`.github/`에 workflow 없음).

**아직 하지 않은 것** (이번 변경 범위 밖, 실제로 Release를 배포하기 전 별도로 필요):

- 실제 upload keystore 생성(`keytool -genkeypair` 등)과 안전한 보관.
- Google Play Console에 앱 등록, Play App Signing 활성화(최초 업로드 시 Play Console이 유도한다), upload key 등록.
- Production Firebase 프로젝트 생성과 `android/app/src/release/google-services.json` 배치.
- Production Backend/API 확정과 `JUPLE_API_BASE_URL`.

**Upload key SHA-256 vs Play App Signing key SHA-256 vs `assetlinks.json`**:

Android App Links(`.well-known/assetlinks.json`)에 넣어야 하는 fingerprint는 **실제로 사용자 기기에 설치되는 APK를 서명하는 인증서**의 SHA-256이어야 한다. Play App Signing을 쓰면 그건 upload key가 아니라 **App Signing key**다 - 이 둘은 서로 다른 인증서이고 SHA-256 값도 다르다. App Signing key의 실제 SHA-256은 Play Console 등록 이후 **Play Console → 해당 앱 → Setup → App integrity → App signing key certificate** 페이지에서 확인한다(로컬 keystore에서 계산하는 값이 아니다 - upload key로 `keytool`/`signingReport`를 아무리 돌려도 나오지 않는다). 이 값이 나오기 전까지 `assetlinks.json`에 Production fingerprint를 채워 넣지 않는다(추측 금지, `apps/web`의 `androidAssetlinksSha256Fingerprints`도 마찬가지 - `infra/azure/README.md`의 "Web custom domain" 섹션 참고).

혼동하기 쉬운 4개의 서로 다른 fingerprint를 명확히 구분한다:

| 용도 | Keystore | 이 문서 시점의 SHA-256 |
| --- | --- | --- |
| Debug/현재 `release` (이번 변경 전) | `android/app/debug.keystore`(머신별) | 머신마다 다름 - 어디에도 등록하지 않는다 |
| Dogfood (`assembleDogfood`) | 전용 고정 keystore, PC 간 복사 | [[dogfood-signing-fingerprint]] 메모리 참고 - App Links와 무관, Dogfood 전용 |
| Production upload key (이번 섹션) | 아직 미생성 | 생성 후에도 `assetlinks.json`에 넣지 않는다 - upload key는 App Links 대상이 아니다 |
| Production 실제 배포 서명 (App Links에 필요한 값) | Google 보관 App Signing key | Play Console 등록 후에만 확인 가능 - 아직 없음 |

참고로 Dev 환경(`dev.juple.co.kr`)의 `assetlinks.json`에 이미 들어 있는 fingerprint(`infra/azure/README.md`의 "Web custom domain" 섹션, live `ANDROID_ASSETLINKS_SHA256_FINGERPRINTS`)는 이 표의 어느 것과도 값이 다르다 - 어느 keystore가 서명한 것인지 이 repo에 기록되어 있지 않으므로 추측하지 않았고, Production 값을 정할 때 그 값을 재사용해서도 안 된다(Dev/Production은 별개의 fingerprint를 가진다).

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
