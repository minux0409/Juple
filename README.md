# Juple

Juple은 발견한 상품과 콘텐츠를 빠르게 저장하고, 나중에 검토·정리·구매 기록·반복 구매 관리까지 이어 주는 글로벌 서비스다. 단순 링크 저장이나 위시리스트를 넘어 사용자의 실제 구매 흐름을 신뢰성 있게 관리하는 것을 목표로 한다.

## 현재 상태

현재 저장소에는 React Native CLI 기반 모바일 앱만 존재한다.

- React Native `0.87.0`
- React `19.2.3`
- TypeScript
- Android / iOS 네이티브 프로젝트 포함
- Android 기본 빌드 및 API 36 에뮬레이터 실행 확인
- Android applicationId / iOS Bundle Identifier: `com.juple.app`
- Web, Backend, Azure 인프라는 아직 생성되지 않음

Juple은 Google Play Store, Apple App Store, Web 출시와 장기 운영을 전제로 하는 Production-oriented 프로젝트다.

## Technology Overview

| 영역         | 기술                                                 |
| ------------ | ---------------------------------------------------- |
| Mobile       | React Native CLI, TypeScript                         |
| Web          | Next.js, TypeScript (예정)                           |
| Backend      | .NET 10 LTS, ASP.NET Core Web API, EF Core 10 (예정) |
| Architecture | Modular Monolith (예정)                              |
| Database     | Azure SQL Database (예정)                            |
| Cloud        | Microsoft Azure (예정)                               |
| Push         | FCM, APNs, Azure Notification Hubs (예정)            |

## Repository Structure

```text
Juple/
├─ apps/
│  ├─ mobile/       # current: React Native app
│  └─ web/          # planned
├─ backend/         # planned
├─ infra/           # planned
├─ docs/
└─ .github/
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

### Android에서 로컬 Backend 연결

Mobile 개발용 API 주소는 `http://localhost:5092`로 고정되어 있으며, Android emulator와 physical device 모두 다음 명령으로 PC의 Backend에 연결한다.

```powershell
adb reverse tcp:5092 tcp:5092
adb reverse --list
```

`10.0.2.2`(emulator 전용 host alias)에 의존하지 않는 이유는 physical device에서는 사용할 수 없기 때문이다. 이 port forwarding은 device/emulator가 PC와 연결된 동안만 유지되는 development 전용 설정이며, device 재연결·emulator 재시작·adb server 재시작·PC 재시작 후에는 다시 실행해야 할 수 있다.

## Documentation

- [Product Overview](docs/product-overview.md)
- [Architecture](docs/architecture.md)
- [Development Principles](docs/development-principles.md)
- [Copilot Instructions](.github/copilot-instructions.md)
