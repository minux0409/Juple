# Development Principles

## 기본 원칙

1. 기존 architecture를 임의로 변경하지 않는다.
2. 필요한 이유가 없는 framework나 library를 추가하지 않는다. 추가가 필요하면 이유와 대안을 먼저 설명한다.
3. 임시 mock을 Production 구현처럼 남기지 않는다.
4. “일단 간단하게 만들고 나중에 갈아엎자”는 접근을 피한다.
5. 필요하지 않은 premature optimization도 하지 않는다.
6. 변경 전에 기존 동작과 영향 범위를 확인한다.
7. 요구사항이 불명확하면 큰 설계 결정을 임의로 내리지 않는다.
8. 기능 구현 전 관련 docs와 architecture를 먼저 확인한다.

## 플랫폼과 사용자 경험

1. Android에서만 동작하는 구현을 공통 기능으로 작성하지 않는다.
2. 모든 Mobile 변경은 iOS 영향을 함께 검토한다.
3. React Native CLI를 사용하며 Expo로 전환하지 않는다.
4. UI 문자열은 코드에 하드코딩하지 않고 i18n/l10n 확장을 고려한다.
5. 날짜·시간을 특정 국가 시간으로 하드코딩하지 않는다.
6. Currency를 KRW로 하드코딩하지 않는다.

## 데이터와 보안

1. 서버에서 사용자별 데이터 격리를 강제한다.
2. URL, text 등 외부 입력을 신뢰하지 않는다.
3. Password, Token, Secret을 로그에 남기지 않는다.
4. Secret을 source code에 저장하지 않는다.
5. DB schema 변경은 EF Core Migration으로 추적한다.
6. API는 versioning 가능한 구조를 고려한다.
7. 사용자가 직접 작성한 값은 원문을 보존한다.
8. 확인하지 못한 Metadata나 AI 분석 결과를 확정 데이터로 저장하지 않는다.
9. 외부 구매 여부나 가격을 근거 없이 자동 확정하지 않는다.

## AI coding agent 규칙

- 작업 시작 전에 이 문서와 `docs/product-overview.md`, `docs/architecture.md`를 읽는다.
- 요청 범위를 벗어난 파일·프로젝트·인프라를 생성하지 않는다.
- 변경 전 현재 구조와 관련 테스트를 확인한다.
- 가장 작은 변경으로 요구사항을 충족하고, 좁은 범위의 검증을 먼저 수행한다.
- 설치·업데이트·삭제·커밋·push가 명시되지 않았다면 수행하지 않는다.
- 불확실하거나 실패한 결과는 숨기지 말고 원인과 남은 위험을 보고한다.
- 기능 구현 완료 전 기존 Android와 iOS 동작을 각각 고려한다.
