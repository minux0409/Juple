# Juple Copilot Instructions

모든 작업 전에 다음 문서를 먼저 읽는다.

- `docs/product-overview.md`
- `docs/architecture.md`
- `docs/development-principles.md`

## 필수 기준

- Juple은 Google Play Store, Apple App Store, Web 출시를 목표로 하는 Production-oriented 글로벌 서비스다.
- 현재 실제 프로젝트는 `apps/mobile`뿐이다. Web, Backend, Azure 인프라를 생성된 것처럼 가정하거나 임의로 생성하지 않는다.
- Mobile은 React Native CLI + TypeScript이며 Expo를 사용하지 않는다. Android와 iOS를 동등하게 고려한다.
- 기존 architecture, package, 식별자, 플랫폼 동작을 임의로 변경하지 않는다.
- 새 framework나 library는 필요성과 대안을 먼저 설명한 뒤 추가한다.
- 임시 mock, 임시 구조, 불확실한 AI·Metadata 결과를 Production 사실처럼 남기지 않는다.
- 사용자별 데이터 격리는 서버에서 강제하고 외부 입력을 신뢰하지 않는다.
- Secret, Password, Token은 소스와 로그에 남기지 않는다.
- 시간은 UTC 저장 후 사용자 TimeZone으로 표현하며, 금액은 `Amount`와 `CurrencyCode`를 함께 관리한다.
- UI 문자열, 날짜·시간, 통화는 특정 언어나 국가에 하드코딩하지 않는다.
- DB schema 변경은 EF Core Migration으로 추적하고 API versioning을 고려한다.
- 요청되지 않은 설치, 업데이트, 삭제, 프로젝트 생성, 커밋, push를 하지 않는다.
- 구현 전 영향 범위를 확인하고, 작은 변경 후 가장 가까운 검증을 실행한다.
- 실패나 불확실성을 숨기지 말고 정확한 원인과 남은 위험을 보고한다.
