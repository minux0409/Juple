# 멤버십 누적 변경 최종 검토 — 재가입 경합 수정 반영

검토일: 2026-11-21 (KST). 실제 stage/Commit/Push 없음. PROD 설정·데이터·배포·마이그레이션·결제 변경 없음.

## 결론

**후속 개발 갱신:** 아래 신규 경합 BLOCKER는 계정 생성 전 이메일 확인, SQL 트랜잭션 안의 승계·기간 확정, 이메일 잠금 및 사용자 행 잠금으로 수정했다. 기존 74개 + 신규 16개 SQL Integration은 90/0/0으로 통과했다. 상세 최신 검증과 운영 제한은 [재가입 동시성 수정](membership-rejoin-concurrency.md)을 따른다. 이 문서의 이전 NO 판정과 실패 증거는 삭제하지 않고 이력으로 남긴다. 실제 Commit/Push 또는 운영 적용은 수행하지 않았다.

### 수정 전 검토 이력

**현재 그대로를 안정적인 커밋 체크포인트로 승인하지 않습니다.** 기존 자동 테스트는 통과하지만, 추가 실제 SQL 재현에서 반환 회원의 이메일 체험 승계와 동시 bootstrap 사이의 경합으로 새 720시간이 잘못 부여됐습니다. 기능 정책이나 운영 데이터를 임의로 바꾸지 않고 별도 수정 대상으로 남겼습니다. 커밋 분할 목록은 아래와 같이 준비했지만 실행 가능한 승인 상태는 아닙니다.

## BLOCKER: 이메일 승계 전에 기존 계정 분기가 정식 체험을 먼저 확정

조건:
0. 멤버십이 활성화된 테스트 구성이고 이메일 기반 재가입 승계 경로(`EntraAccountDeletion.Enabled=true`)를 사용함. 현재 PROD의 Billing 비활성 상태에서 체험이 지급됐다는 의미는 아님.
1. 보존 기간 안의 동일 이메일 해시에 원래 정식 체험 기록이 있고 그 기간은 이미 만료됨.
2. 탈퇴 후 재가입한 새 외부 식별자로 요청 A가 User/ExternalIdentity 생성 트랜잭션을 commit함.
3. 요청 A의 이메일 디렉터리 조회는 지연되지만 정상적으로 성공할 예정임.
4. 그 사이 요청 B가 같은 새 식별자로 bootstrap하면 기존 계정 분기로 진입하며 이메일 승계를 기다리지 않고 체험을 정산함.
5. 요청 B가 새 가입 시각부터 720시간을 먼저 기록함. 이후 A의 승계는 사용자 정식 시작 필드가 이미 채워져 있어 원래 기간을 적용하지 않음.

관측: 두 요청 모두 원래 만료 기간을 재사용하지 않았고, 새 체험 및 쓰기 가능 상태가 반환됨. 원래 기간 재사용 기대 assertion 2개가 실패함. 익명 합성 데이터만 사용했으며 실제 이메일·구매·PROD 연결·네트워크 호출 없이 로컬 전용 SQL에서 재현함. 테스트가 생성한 데이터만 정리했고 기존 데이터는 변경하지 않았음.

관련 코드:
- `backend/src/Juple.Application/Users/BootstrapCurrentUser/CurrentUserBootstrapService.cs`: 기존 계정 조기 반환 및 CreateAsync 이후 InheritTrialWindowAsync 순서.
- `backend/src/Juple.Infrastructure/Users/DeleteAccount/EntraIdentityDeletionStore.cs`: InheritOfficialAsync의 NULL일 때만 투영하는 조건.
- `backend/src/Juple.Infrastructure/Billing/EntitlementStore.cs`: 공식 Ledger 생성 및 사용자 체험 투영.

이 문제는 단순 디렉터리 장애가 아니다. 디렉터리가 정상 응답해도 요청 순서만으로 발생한다. 기존 8개 동시 신규 가입과 순차 재가입 SQL 검증은 이 순서를 포함하지 않았다. 임시 재현 결과 파일명은 `email-inheritance-race-safe.json`이며 로컬 검토 산출물로만 보존한다. 절대 경로·SQL 데이터·검증 도구·자격정보는 커밋 대상이 아니다.

후속 수정 방향: 검증된 이메일 체험 승계가 완료되기 전 다른 요청이 미확정 체험을 새로 정산하지 못하도록 계정 생성·승계·정산 경계를 정의해야 한다. 기존 생성 트랜잭션에서 원래 기간을 확정하거나 미완료 상태를 명시적으로 직렬화하는 방안을 검토할 수 있으나, 이 검토 작업에서 임의 선택하지 않았다. 원래 기록 삭제/초기화, 랜덤 식별자, 다른 사용자 Ledger 선택, 운영 수동 데이터 보정으로 우회해서는 안 된다. 같은 시나리오를 영구 SQL 회귀 테스트에 포함하고 재검증한 뒤 커밋 승인한다.

## Git 및 민감정보 검사

- master, fetch 후 HEAD == origin/master == `8e176c6e44a9f7d50ae75adbd71f9a3dadd4d0e6`; ahead/behind 0/0.
- 시작 시 작업 파일 74개(추적 수정 46, 신규 작업 28), 보호 미추적 3개 별도. 이 보고서 추가 후 75개 후보(추적 수정 46, 신규 작업 29).
- 보호 파일 `apps/admin/AGENTS.md`, `apps/admin/CLAUDE.md`, `logcat-r35a-final-polish-samsung.txt`는 크기/SHA-256 보존, 커밋 후보에서 제외.
- 기존 사용자 작업의 무관한 변경은 확인되지 않았다. 이전 35개 멤버십 작업은 현재 목표와 연관성을 확인해 보존했다. 다른 기능이 언급된 문서의 변경되지 않은 기존 내용은 새 변경으로 취급하지 않았다.
- 전체 후보에 대해 개인키/JWT/Bearer/비밀번호·서비스 자격 literal/주문번호/이메일/PC 절대 경로 패턴과 관련 diff를 검토했다. 실제 비밀값·실구매 토큰·실결제 원문·개인정보·PC 절대 경로·임시 DB 데이터는 발견되지 않았다.
- 후보 이메일은 기존 공개 지원 연락처 또는 example 도메인 합성 fixture다. 설계시점 EF 연결은 비접속용 호스트/비밀번호 없음이며 운영 연결이 아니다. 상대 경로의 `Users` 디렉터리와 `/users/...` API, 문서의 password ON/correct 개념은 실제 자격정보로 분류하지 않았다.
- 전체 인덱스를 변경하지 않았고 임시 테스트 도구·TRX·DB 데이터·node_modules·bin/obj·build 사본·설정·서명 파일을 포함하지 않는다.

## 구현·마이그레이션 정합성

정상 식별자의 기존/신규 회원 시작 기준은 max(가입 시각, 프로그램 시작 시각) + 정확히 720시간이다. 과거 TrialLedger는 보존하고 공식 Ledger는 별도다. 유료/관리자 우선순위와 조회/쓰기 정책은 변경하지 않았다. 식별 누락/복수의 미확정 체험은 임의로 지급하지 않는다. 다만 위 이메일 승계 경합 때문에 재가입 반복 방지를 전체적으로 PASS라고 결론 내릴 수 없다.

`20261121082950_AddOfficialMembershipTrials`는 nullable 사용자 컬럼 2개와 별도 테이블·고유 해시 인덱스 추가이며 기존 데이터 backfill/삭제가 없다. Snapshot과 EF 모델은 일치하고 추가 pending model changes가 없다. 이전 source migration은 AdminMembershipGrants다. 실제 PROD 적용 이력/충돌은 여전히 미검증이다. Down은 공식 체험 기록을 버리므로 운영 롤백은 별도 검토가 필요하다. 새 API의 상태 조회는 프로그램 비활성 중에도 새 컬럼을 사용하므로 스키마 선행이 필요하다. PROD에는 적용하지 않았다.

## 현재 테스트 재실행

| 항목 | 이번 결과 |
|---|---|
| Backend 빌드 | 통과 |
| Backend 전체 단위 | 2,636 통과 |
| 요청 범위 SQL Integration | 74 통과 / 0 실패 / 0 건너뜀 |
| 추가 동시 이메일 승계 재현 | 1개 시나리오에서 기대 assertion 2개 실패 |
| Mobile Jest | 268 suites / 3,602 통과 |
| Web 테스트 | 978 통과 / 0 실패 / 0 건너뜀 |
| Mobile/Web TypeScript | 통과 |
| Mobile 현재 src ESLint | 오류 0 |
| Mobile 기본 전체 ESLint | 실패: 보존된 과거 build/Web 사본 15개 파일의 기존 오류 18개; 현재 src 외 신규 오류 없음 |
| Web ESLint | 오류 0, 기존 경고 2 |
| EF Pending Model Changes / 번역 생성기 / diff 공백 | 통과 |

기본 Mobile 전체 ESLint의 보관 build/Web 사본 오류 18개는 이번에도 재확인한 기존 환경 잡음이다. 이를 삭제하거나 규칙을 완화하지 않았다. 전체 기본 lint까지 PASS라고 하지 않는다. Backend의 기존 nullable/analyzer 경고 이력 및 LF/CRLF 알림도 남는다. 실제 스토어/실결제/실기기 RTL·구버전 업그레이드·iOS Native 빌드는 실행하지 않았다.

## 다국어·약관

17개 언어의 키 집합·플레이스홀더·720시간·날짜/가격 템플릿과 기존/신규 기준을 자동 검증했다. Native Arabic/German/Japanese 본문은 테스트 renderer에서 잘리지 않도록 확인했지만 실제 RTL 픽셀 검증은 아니다. 15개 언어 법률 문구는 `docs/legal/membership-drafts`의 명시적 검수 대기 초안이며 앱/Web 공개 약관이나 동의 화면에서 가져오지 않는다. 시행일·동의 버전은 그대로다. 가격/환불·철회/고지·동의 번역의 원어민·법률 검수는 남아 있다.

## 출시 전 별도 차단 사항

위 승계 경합 수정 외에도 PROD 식별 누락·복수·Ledger·구매/지급 FK 감사, 이상 계정의 검증된 복구 정책, 법률/언어 승인, 지원 앱의 스토어 접근성·업데이트 경로 검증이 필요하다. 이 검토는 출시 승인이나 ProgramEnabled 활성화 승인이 아니다.

## 전체 후보 분류

| 분류 | 파일 수 |
|---|---:|
| 자동 테스트 | 16 |
| 다국어 | 18 |
| Mobile 구현 | 1 |
| Web 구현 | 1 |
| Backend 구현 | 12 |
| DB 마이그레이션 | 3 |
| 개발·운영 문서 | 5 |
| 이용약관 초안·검수 메타데이터 | 19 |

커밋 제외 Git 항목은 보호 미추적 3개다. 그 외 무관한 기존 사용자 작업은 발견되지 않았다. ignored 빌드/설정/서명/로그/임시 SQL 데이터는 집계 밖이며 포함하지 않는다.

## 제안 커밋 1 — 22개 파일

`feat(billing): separate official trials and guard identity settlement`

Backend 구현·마이그레이션·Backend 회귀 테스트를 함께 묶는다. 테스트를 다음 커밋으로 미루면 중간 커밋의 fixture가 새 모델과 맞지 않으므로 원자적으로 포함한다. 발견된 승계 경합을 먼저 수정하고 영구 회귀 테스트를 포함해야 한다.

- `backend/src/Juple.Api/DesignTimeJupleDbContextFactory.cs`
- `backend/src/Juple.Application/Billing/EntitlementService.cs`
- `backend/src/Juple.Domain/Billing/MembershipTrialLedgerEntry.cs`
- `backend/src/Juple.Domain/Billing/TrialLedgerEntry.cs`
- `backend/src/Juple.Domain/Users/User.cs`
- `backend/src/Juple.Infrastructure/Billing/EntitlementStore.cs`
- `backend/src/Juple.Infrastructure/Billing/MembershipGrantStore.cs`
- `backend/src/Juple.Infrastructure/Persistence/Configurations/Billing/MembershipTrialLedgerEntryConfiguration.cs`
- `backend/src/Juple.Infrastructure/Persistence/Configurations/Users/UserConfiguration.cs`
- `backend/src/Juple.Infrastructure/Persistence/Migrations/20261121082950_AddOfficialMembershipTrials.Designer.cs`
- `backend/src/Juple.Infrastructure/Persistence/Migrations/20261121082950_AddOfficialMembershipTrials.cs`
- `backend/src/Juple.Infrastructure/Persistence/Migrations/JupleDbContextModelSnapshot.cs`
- `backend/src/Juple.Infrastructure/Retention/RetentionStore.cs`
- `backend/src/Juple.Infrastructure/Users/DeleteAccount/AccountDeletionStore.cs`
- `backend/src/Juple.Infrastructure/Users/DeleteAccount/EntraIdentityDeletionStore.cs`
- `backend/tests/Juple.IntegrationTests/Billing/GooglePlayBillingIntegrationTests.cs`
- `backend/tests/Juple.IntegrationTests/Billing/MembershipIdentitySafetyIntegrationTests.cs`
- `backend/tests/Juple.IntegrationTests/Billing/TrialFoundationIntegrationTests.cs`
- `backend/tests/Juple.IntegrationTests/Retention/RetentionStoreIntegrationTests.cs`
- `backend/tests/Juple.UnitTests/Billing/GooglePlay/GoogleBillingControllerTests.cs`
- `backend/tests/Juple.UnitTests/Billing/TrialAndEntitlementTests.cs`
- `backend/tests/Juple.UnitTests/Billing/TrialIdentityHasherAndServiceTests.cs`

## 제안 커밋 2 — 19개 파일

`docs(legal): prepare unapproved membership amendments in 15 languages`

문서와 검수 상태만 포함하며 활성 약관 라우트에 연결하지 않는다. 다음 커밋의 Mobile/Web 테스트가 이 초안/manifest 파일을 읽으므로 UI 커밋보다 먼저 둔다.

- `docs/legal/membership-drafts/README.md`
- `docs/legal/membership-drafts/ar.md`
- `docs/legal/membership-drafts/de.md`
- `docs/legal/membership-drafts/es.md`
- `docs/legal/membership-drafts/fr.md`
- `docs/legal/membership-drafts/hi.md`
- `docs/legal/membership-drafts/id.md`
- `docs/legal/membership-drafts/it.md`
- `docs/legal/membership-drafts/ja.md`
- `docs/legal/membership-drafts/pt-BR.md`
- `docs/legal/membership-drafts/review-status.json`
- `docs/legal/membership-drafts/ru.md`
- `docs/legal/membership-drafts/th.md`
- `docs/legal/membership-drafts/tr.md`
- `docs/legal/membership-drafts/vi.md`
- `docs/legal/membership-drafts/zh-Hans.md`
- `docs/legal/membership-drafts/zh-Hant.md`
- `docs/legal/privacy-policy.draft.md`
- `docs/legal/terms.draft.md`

## 제안 커밋 3 — 29개 파일

`feat(membership): align localized trial guidance and billing notices`

17개 locale, 생성된 Web 문자열, Mobile/Web 구현과 관련 테스트를 함께 묶는다. 생성물만/원문만 따로 커밋하지 않는다. 이전 법률 초안 커밋이 있어야 새 테스트가 독립 실행된다.

- `apps/mobile/src/billing/__tests__/TrialNotice.test.tsx`
- `apps/mobile/src/billing/__tests__/membershipPolicyCopy.test.ts`
- `apps/mobile/src/billing/__tests__/membershipPolicyLanguages.test.ts`
- `apps/mobile/src/billing/__tests__/membershipPrompts.test.tsx`
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
- `apps/mobile/src/screens/SubscriptionScreen.tsx`
- `apps/mobile/src/screens/__tests__/SubscriptionPlans.test.tsx`
- `apps/mobile/src/screens/__tests__/SubscriptionScreen.test.tsx`
- `apps/web/lib/appI18nMobile.generated.ts`
- `apps/web/lib/legalContent.ts`
- `apps/web/tests/legalPages.test.ts`
- `apps/web/tests/membershipPolicyTranslations.test.ts`
- `apps/web/tests/publicLaunch.test.ts`

## 제안 커밋 4 — 5개 파일

`docs(billing): record validation history and rollout blockers`

이전 검증 이력을 삭제하지 않고 최신 결과/차단 문제와 구분한다. 운영 배포 승인이나 개인정보 보유 정책 변경을 포함하지 않는다.

- `docs/architecture.md`
- `docs/data-retention.md`
- `docs/membership-commit-review.md`
- `docs/membership-identity-safety.md`
- `docs/membership-launch-readiness.md`

## 제외 대상

- `apps/admin/AGENTS.md` — 기존 보호 파일, 수정/삭제/이동/stage 금지
- `apps/admin/CLAUDE.md` — 기존 보호 파일, 수정/삭제/이동/stage 금지
- `logcat-r35a-final-polish-samsung.txt` — 기존 보호 파일, 수정/삭제/이동/stage 금지
- ignored 설정·키·keystore·빌드·로그·bin/obj·node_modules와 외부 검토 도구/DB/TRX — 커밋하지 않음

이 목록은 계획이며 stage 명령을 실행하지 않았다. 승계 경합 수정·검증 전에는 제안 커밋을 승인 상태로 취급하지 않는다.
