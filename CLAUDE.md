# Juple Claude Instructions

작업 전에 다음 문서를 먼저 읽는다.

- `docs/product-overview.md`
- `docs/architecture.md`
- `docs/development-principles.md`

## 프로젝트 기준

- Juple은 Google Play Store, Apple App Store, Web 출시를 목표로 하는 Production-oriented 글로벌 서비스다.
- 현재 실제 프로젝트는 `apps/mobile`뿐이다. Web, Backend, Azure 인프라는 아직 생성되지 않았다.
- Mobile은 React Native CLI + TypeScript이며 Expo를 사용하지 않는다.
- Android와 iOS를 동등한 정식 플랫폼으로 고려한다.
- 기존 architecture, package, 식별자, 플랫폼 동작을 임의로 변경하지 않는다.

## 구현 규칙

- 작업 범위를 벗어난 프로젝트, 파일, framework, library를 추가하지 않는다.
- 새 dependency가 필요하면 이유와 대안을 먼저 설명한다.
- 변경 전 관련 문서와 현재 구현, 영향 범위를 확인한다.
- 작은 변경 후 가장 가까운 검증을 실행한다.
- 임시 mock이나 불확실한 AI·Metadata 결과를 Production 사실처럼 저장하지 않는다.
- AI는 보조 기능이며 사용자가 확인하기 전 확정 데이터로 저장하지 않는다.

## 데이터와 보안

- 사용자별 데이터 격리는 서버에서 강제한다.
- 외부 입력(URL, text 등)을 신뢰하지 않는다.
- Identity Provider UID와 내부 UserId를 분리한다.
- 시간은 UTC로 저장하고 사용자 TimeZone으로 표현한다.
- 금액은 `Amount`와 `CurrencyCode`를 함께 관리한다.
- UI 문자열, 날짜·시간, 통화를 특정 언어·국가에 하드코딩하지 않는다.
- Password, Token, Secret을 source code나 로그에 남기지 않는다.
- DB schema 변경은 EF Core Migration으로 추적하고 API versioning을 고려한다.

## 작업 제한

요청하지 않은 설치, 업데이트, 삭제, 프로젝트 생성, commit, push를 수행하지 않는다. 실패나 불확실성은 숨기지 말고 원인과 남은 위험을 보고한다.
