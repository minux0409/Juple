# 멤버십 식별 안전성 — 구현 및 검증, 운영 적용 대기

PROD `ProgramEnabled=false` 유지. 운영 DB의 식별 누락·복수 연결 여부는 아직 감사하지 못했습니다. 이번 코드는 운영 데이터 복구나 식별자 이관을 수행하지 않습니다.

> 최종 검토에서 발견한 이메일 승계/동시 bootstrap 경합은 계정 공개 전 원자적 승계와 SQL 잠금으로 수정했습니다. 신규 영구 SQL 경합 회귀를 포함한 최신 결과·제한은 [재가입 동시성 수정](membership-rejoin-concurrency.md)을 따릅니다. 아래 74개 결과는 수정 전 검증 이력이며 PROD 정합성 감사·운영 적용은 여전히 대기 상태입니다.

## 원인과 정상 가입

Google Billing SQL fixture는 User만 생성하고 과거 `SetTrial` 필드만 채웠습니다. 정식 체험 초기화에는 검증 가능한 ExternalIdentity가 필요하므로 기존 4건이 실패했습니다. 실제 `CurrentUserProvisioningStore.CreateAsync`는 User와 ExternalIdentity를 하나의 트랜잭션에서 생성하고 중복 외부 식별자 경합 시 롤백/재조회합니다. fixture도 이 경로를 사용하며 계정 생성 시각을 의도한 정식 체험 시작과 일치시켰습니다. 기존 검증 assertion이나 소유권 검사를 제거하지 않았습니다.

## 불완전한 식별 상태

이용 권한은 UserId에 귀속된 서버 검증 구독·관리자 지급·정식 체험에서 계산됩니다. API의 기존 인증·소유권 검사는 그대로입니다. 클라이언트가 임의 UserId나 식별자를 제출해 이용 권한을 받는 경로를 추가하지 않습니다.

| 상태 | 동작 |
|---|---|
| 단일 정상 식별자, 정식 체험 미확정 | 기존 정책대로 시작 시각/가입 시각부터 정확히 720시간 정산 |
| 정식 체험 필드가 이미 확정 | 같은 기간을 재사용; 만료 후 재지급하지 않음 |
| 식별자 누락/복수, 유효한 유료 구독 | 서버 검증된 해당 UserId 구매 권한 유지; 새 체험은 만들지 않음 |
| 식별자 누락/복수, 활성 관리자 무료 멤버십 | 해당 지급 기간 권한 유지; 새 체험은 만들지 않음 |
| 식별자 누락/복수, 확정 체험·유효 권한 없음 | `MembershipTrialIdentityException`; 임의 연결·무제한 체험·과거 테스트 기간 재활용 없음 |
| 결제 보류·OnHold·만료, 식별 미확정 | 유료 권한으로 인정하지 않고 식별 검토 필요 |
| 동일 외부 식별자 중복 연결 | 기존 SQL 고유 제약으로 거부; 다른 User로 이관하지 않음 |

복수 연결은 기존 코드의 정렬되지 않은 FirstOrDefault를 권한 근거로 사용하지 않습니다. 실제 개수를 확인하여 단일일 때만 정식 체험용 식별자를 반환합니다. 확정된 이용 권한은 버리지 않습니다. 미확정 복수 연결의 대표 식별자/이전 Ledger 선택 정책은 정의돼 있지 않으므로 자동 선택하지 않습니다.

식별 미확정 오류는 현재 예외 처리에서 서버 오류로 전달될 수 있습니다. 이를 결제 필요/Expired로 위장하지 않습니다. 해당 운영 사용자가 존재하면 **출시 BLOCKER**이며, 인증된 계정 연결 복구 절차와 사용자 안내 정책을 별도로 검토해야 합니다. 이 코드가 모든 과거 계정의 자동 복구를 완료했다는 뜻은 아닙니다.

GetForIdentity가 매핑을 찾지 못할 때는 기존 CurrentJupleUserNotFound 동작을 유지합니다. 이메일이 같다는 이유로 고아 User의 데이터·구매를 새 계정에 자동 연결하지 않습니다. 기존 이메일 HMAC 정책은 보존 기간 내 체험 반복 방지용이며 계정 소유권 복구 수단으로 확대하지 않습니다.

## 보존한 정책

기존 회원은 정식 시작부터, 이후 가입자는 가입부터 720시간. 과거 TrialLedger·구매 기록은 유지하고 MembershipTrialLedger는 별도 관리합니다. 유료/관리자 우선순위, 취소 후 유효 기간, 만료 시 쓰기 제한, 기존 조회/필수 계정 기능 정책을 변경하지 않습니다. 보존 기간은 24개월로 유지하며 영구 식별을 약속하지 않습니다. 새 마이그레이션은 추가하지 않았습니다.

## 검증 및 남은 운영 감사

- 수정 전 실패 4건을 실제 SQL에서 재현했고 TRX를 보존했습니다.
- 신규 SQL 테스트는 누락/복수 식별자, 확정 체험, 유효한 Active/Canceled/GracePeriod 구매, 관리자 지급, 보류·중단·만료 결제 및 중복 외부 식별자 연결을 검증합니다.
- 정상 신규/기존 회원, 과거 Ledger, 재가입, 정식 Ledger, 동시성은 기존 정식 체험 SQL 테스트와 함께 검증합니다.
- 식별자별 중복 User 연결, User별 식별자 수, 고아 계정, 미완성 정식 체험 필드, Ledger/사용자 기간 일치, 구매·지급 FK를 운영 DB에서 읽기 전용 집계해야 합니다. 실제 PROD 존재 여부는 미검증입니다.
- 운영 DB 보정, 복구 마이그레이션, 새 식별자 생성/추정, 결제 활성화는 수행하지 않습니다.

## 다국어 개정

17개 언어의 기존 키 구조를 유지했습니다. 나머지 15개 언어는 무료 체험 시작 기준, 정확한 시간, 종료 후 권한, 자동 유료 전환 없음, 즉시 구매 결제, 삭제 시 구독 유지 안내를 반영했습니다. 결제·통화·날짜는 기존 스토어/서버/Intl 경로를 유지합니다.

관련 약관 개정안은 [검수 대기 초안 목록](legal/membership-drafts/README.md)에만 존재하며 앱/Web 동의 화면에서 읽지 않습니다. 시행일·동의 버전은 변경하지 않았습니다. 모든 초안은 원어민·법률 검수 대기이며 실제 작은 화면/큰 글꼴/아랍어 RTL 확인은 자동 테스트와 구분해야 합니다.

## 최종 검증 결과 (2026-11-21)

| 검증 | 결과 |
|---|---|
| 요청 범위 SQL Integration 전체 | 74 통과 / 0 실패 / 0 건너뜀 |
| Google Billing SQL | 20 통과 (기존 실패 4건 포함) |
| 정식 체험 / 식별 안전성 SQL | 12 / 15 통과 |
| 계정 삭제 / Entra 재가입 SQL | 6 / 7 통과 |
| Retention / 관리자 / 삭제계획 SQL | 10 / 3 / 1 통과 |
| Backend 전체 단위 테스트 | 2,636 통과 |
| Mobile 전체 Jest | 268 suites / 3,602 통과 |
| Web 전체 테스트 | 978 통과 / 0 실패 / 0 건너뜀 |
| Mobile·Web TypeScript | 통과 |
| Mobile 현재 src ESLint | 오류 0 |
| Web ESLint | 오류 0, 기존 경고 2 |
| EF 모델 | 추가 pending model changes 없음 |

SQL 범위는 Google Billing(마이그레이션 테스트 포함), 정식 체험, 식별 안전성, 계정 삭제·재가입, Retention, 관리자 멤버십 및 삭제계획이다. 전체 Backend Integration 프로젝트의 모든 도메인을 실행했다는 뜻은 아니다. 모두 로컬 localhost,14333/JupleRetTests에서 실행했다. 기존 테스트 SQL 스키마에 AppleAccountLinks/AdminMembershipGrants/OfficialMembershipTrials의 필요한 추가 마이그레이션만 적용했고 초기화·강제 삭제는 하지 않았다. PROD DB는 사용하지 않았다.

중간 실패도 보존했다. 최초 4건은 수정 전 실제 재현했다. Retention 삭제계획은 다른 이름의 전용 DB를 거부하는 안전장치로 한 번 실패했으며, 검증 조건을 바꾸지 않고 JupleRetTests에서 통과했다. 새로운 테스트의 node:fs 타입 오류는 기존 RN 테스트의 typed require 패턴으로 해결했으며 패키지/tsconfig 변경은 없다. 새 안내가 과거 '첫 한 달' 문구를 대체하면서 실패한 Welcome 테스트는 720시간·회원 시작 기준·자동 과금 없음·즉시 구매·조회 유지에 대한 더 구체적인 검증으로 갱신해 전체 재통과했다.

기본 Mobile 전체 ESLint는 보존된 android/app/build 안의 과거 Web 소스 사본에서 기존 오류 18개가 남아 실패한다. 현재 src와 변경 테스트는 오류가 없고, 보관 사본·로그를 삭제하거나 ESLint 설정을 완화하지 않았다. 전체 lint가 통과했다고 보고하지 않는다.

실제 Android/iOS 앱 설치·빌드·스토어 구매·RTL 스크린샷 검증은 하지 않았다. 언어키/플레이스홀더/스토어 가격 템플릿/날짜 삽입과 Arabic/German/Japanese 본문 렌더·줄수 제한 없음은 자동 검증했지만 원어민 감수나 실제 작은 화면의 픽셀 검증을 대신하지 않는다.

PROD 실행 중 appsettings의 ProgramEnabled=false를 읽기 전용으로 재확인했다. 실제 PROD 식별 누락/복수·Ledger 정합성은 미검증이며, 운영 데이터 복구·마이그레이션 적용·배포·결제 활성화·Commit/Push는 하지 않았다. 기존 720시간·24개월 정책과 동의 버전/시행일을 변경하지 않았다.

## 이번 라운드 변경 파일

기존 작업 35개를 포함한 working tree 전체는 74개 작업 파일이며 보호 미추적 파일 3개는 별도다. 이번 라운드에서 변경/추가한 파일은 다음 45개다. 모두 미커밋이다.

- `apps/mobile/src/billing/__tests__/membershipPolicyLanguages.test.ts`
- `apps/mobile/src/billing/__tests__/membershipPrompts.test.tsx`
- `apps/mobile/src/billing/__tests__/TrialNotice.test.tsx`
- `apps/mobile/src/i18n/locales/ar.json`
- `apps/mobile/src/i18n/locales/de.json`
- `apps/mobile/src/i18n/locales/en.json`
- `apps/mobile/src/i18n/locales/es.json`
- `apps/mobile/src/i18n/locales/fr.json`
- `apps/mobile/src/i18n/locales/hi.json`
- `apps/mobile/src/i18n/locales/id.json`
- `apps/mobile/src/i18n/locales/it.json`
- `apps/mobile/src/i18n/locales/ja.json`
- `apps/mobile/src/i18n/locales/ko.json`
- `apps/mobile/src/i18n/locales/pt-BR.json`
- `apps/mobile/src/i18n/locales/ru.json`
- `apps/mobile/src/i18n/locales/th.json`
- `apps/mobile/src/i18n/locales/tr.json`
- `apps/mobile/src/i18n/locales/vi.json`
- `apps/mobile/src/i18n/locales/zh-Hans.json`
- `apps/mobile/src/i18n/locales/zh-Hant.json`
- `apps/web/lib/appI18nMobile.generated.ts`
- `apps/web/tests/membershipPolicyTranslations.test.ts`
- `backend/src/Juple.Application/Billing/EntitlementService.cs`
- `backend/src/Juple.Infrastructure/Billing/EntitlementStore.cs`
- `backend/tests/Juple.IntegrationTests/Billing/GooglePlayBillingIntegrationTests.cs`
- `backend/tests/Juple.IntegrationTests/Billing/MembershipIdentitySafetyIntegrationTests.cs`
- `backend/tests/Juple.UnitTests/Billing/TrialIdentityHasherAndServiceTests.cs`
- `docs/legal/membership-drafts/ar.md`
- `docs/legal/membership-drafts/de.md`
- `docs/legal/membership-drafts/es.md`
- `docs/legal/membership-drafts/fr.md`
- `docs/legal/membership-drafts/hi.md`
- `docs/legal/membership-drafts/id.md`
- `docs/legal/membership-drafts/it.md`
- `docs/legal/membership-drafts/ja.md`
- `docs/legal/membership-drafts/pt-BR.md`
- `docs/legal/membership-drafts/README.md`
- `docs/legal/membership-drafts/review-status.json`
- `docs/legal/membership-drafts/ru.md`
- `docs/legal/membership-drafts/th.md`
- `docs/legal/membership-drafts/tr.md`
- `docs/legal/membership-drafts/vi.md`
- `docs/legal/membership-drafts/zh-Hans.md`
- `docs/legal/membership-drafts/zh-Hant.md`
- `docs/membership-identity-safety.md`

