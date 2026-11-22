# Membership consent implementation and rollout gates

검토 기준: 2026-11-22, master `8d94f44cb4bfa2ad620eb9afbb43b6fe16b10228`.

상태: **코드 구현 및 자동 테스트 완료 / 운영 적용 대기**. 아래 Git 상태는 개발 검증 당시의 기록이다. 후속 사용자 승인에 따라 Git 체크포인트를 생성하며 최종 커밋은 Git 이력을 참조한다. 이 문서는 약관 승인, 시행일 확정, 동의 버전 변경 또는 PROD 배포 승인이 아니다.

## 구현

### 공개 본문과 동의의 연결

- 기존 공개 Web 약관(2026-10-25)을 문구 변경 없이 Application의 `Safety/PublishedTerms.json`으로 옮겼다. 새 멤버십 개정 초안은 가져오지 않았다.
- 문서 버전, 본문 SHA-256, 실제 본문 언어, 요청 UI 언어와 동의 가능 여부를 한 계약으로 전달한다. Android/iOS와 Web은 서버 문서를 표시하며 과거 내장 약관 요약을 동의 본문으로 사용하지 않는다.
- `GET /api/v1/terms/document?version=...&language=...`는 설정된 현재 버전만 제공한다. 등록되지 않은 현재 버전은 503, 요청 도중 달라진 버전은 409다. 문서 실패 시 임의의 과거 본문으로 대체하지 않는다.
- 동의 요청에는 버전·본문 해시·요청 언어·만 14세 이상 확인을 보낸다. 서버는 등록된 본문 및 동의 허용 언어와 맞지 않으면 저장하지 않는다. 클라이언트가 보낸 해시는 독해 여부나 본인 확인의 증명은 아니다.
- 현재 실제 공개 전문 언어는 한국어다. 17개 UI 언어에 같은 문서 계약을 제공하지만 한국어 이외 언어는 원문 열람만 가능하고 `canAccept=false`다. 한국어 대체 동의 허용을 임의로 확정하지 않았다. 번역 승인 또는 별도 대체 동의 정책 승인이 필요하다.
- 언어별 약관 개정 초안과 review-status.json은 변경하지 않았다. 새 `agreement.documentUnavailable`은 17개 언어의 UI 오류 안내이며 법적 약관 번역 승인이 아니다. 원어민 UI 검수도 별도로 필요하다.
- 기존 약관 날짜와 TermsOptions 기본 버전은 그대로다. 운영 설정을 변경하지 않았다.

Web의 Docker 빌드 컨텍스트는 apps/web 단독이다. 기존 다국어 생성 방식처럼 `scripts/generateConsentDocuments.mjs`로 Backend 문서와 Mobile 순수 파서를 Web 내부에 생성한다. 생성본을 직접 수정하지 않는다. Web 테스트가 원본과 생성본의 일치를 검사한다. 재생성:

```powershell
node apps/web/scripts/generateConsentDocuments.mjs
node apps/web/scripts/generateMobileStrings.mjs
```

기존 공개 버전의 본문 해시는 회귀 테스트에 고정했다. 이미 게시된 버전의 본문을 바꾸고 같은 버전으로 재동의를 생략하는 변경은 허용하지 않는다. 향후 승인된 개정 본문·언어별 전문 등록과 과거 버전 보관 방식은 개정 약관 게시 승인에 포함해야 한다. 현재 구현은 단일 게시 버전을 제공하고 알 수 없는 버전은 차단한다.

약관 본문은 버전별 고정 자료다. 기존 공개 연락처 기본값을 포함한다. 런타임의 운영자 표시 정보는 별도로 유지되지만, 약관 본문 내 연락처를 설정만으로 바꿔 동의 해시와 다른 본문을 보여주는 방식은 사용하지 않는다. 공개 연락처 변경도 원문 검토에 포함해야 한다.

### 연령 확인

- 특정 버전 문자열과 연령 확인을 연결하던 조건을 제거했다. 모든 동의 버전에 true가 필요하고 false/누락은 계정·동의 저장 접근 전에 거절된다.
- 기존 회원의 새 약관 동의도 같은 경로다. 이미 저장된 과거 동의를 소급 변경하거나 나이를 추정하지 않는다. 이는 기존 만 14세 이상 자기 확인 정책이며 실명·생년월일 검증을 새로 도입한 것이 아니다.
- 중복 제출, 본문 조회 실패, 구버전 요청, 세션 종료 후 늦게 도착한 응답을 회귀 검증한다. 본문/언어가 달라지면 이전 체크 상태를 재사용하지 않는다.

### 미동의자의 기존 구매 권리

사용자가 이번 라운드에서 직접 확정한 정책에 따라 다음만 일반 서비스 화면 밖에서 제공한다.

- `GET /api/v1/billing/subscription-management`: 인증된 계정의 서버 검증 구매 상태 조회. 체험 초기화용 Entitlement 평가를 호출하지 않는다.
- `POST .../restore/google`, `POST .../restore/apple`: 인증된 계정에 이미 연결된 구매만 기존 Google/Apple 서비스로 재검증한다. 클라이언트 구매 토큰·JWS를 입력받지 않고 신규 구매나 다른 계정의 구매를 연결하지 않는다.
- Google Play와 App Store의 공식 구독 관리 링크를 제공한다. 사용자가 스토어에서 직접 취소하는 경로이며 서버 강제 취소 API를 추가하지 않았다.
- 기존 구독을 복원하더라도 약관 동의나 일반 서비스 진입으로 처리하지 않는다. UI는 구독 상태만 다시 조회하고 bootstrap/무료 체험 지급을 호출하지 않는다.

이 미동의 복원은 **서버에 이미 연결된 구매** 범위다. 미등록·연결되지 않은 기기 구매를 새로 연결하는 토큰 복원은 최신 약관 동의 후 기존 복원 경로를 이용해야 한다. 이 제한 없이 토큰 복원을 열면 신규 구매의 동의 제한을 우회할 수 있다.

신규 구매용 catalog/verify와 토큰을 받아 연결하는 기존 restore에는 명시적 현재 동의 필터를 추가했다. 일반 서비스의 legacy EnforceAcceptance=false 기간에도 이 구매 조건은 적용된다. 현재 Google/Apple 클라이언트는 구매 직전 catalog를 다시 조회하므로 미동의 시 결제창 진입도 막힌다. 일반 서비스의 기존 동의 게이트 및 인증·소유권 검사는 유지했다.

RTDN·App Store 알림·Worker·Reconcile은 이 UI 동의 게이트를 거치지 않는다. 실제 구매 검증·승인·갱신·취소·환불 구현은 수정하지 않았다. 구독이 유효하다는 이유로 동의 상태를 변경하지 않는다.

## 검증 기록

- Backend 전체 단위 테스트: 최종 2,651 통과. 17개 언어 응답의 canAccept·실제 언어·해시 매핑 검증을 포함한다.
- Mobile 전체 Jest: 269 suites / 3,610 통과. 이후 문서 자체 revision과 봉투 version의 일치 가드를 보강하고 아래 관련 테스트 89개를 재실행해 통과했다.
- Mobile 약관·기존 구매 관리·언어 키/플레이스홀더: 89 통과.
- Web 전체: 980 통과. 원본/생성본, 17개 언어, 공개 본문 해시, 미등록 버전·잘못된 문서 거절을 포함한다.
- Mobile/Web TypeScript 및 소스 ESLint를 실행했다. Mobile 기본 `eslint .`는 기존 Android 빌드 폴더에 보존된 Web 소스까지 검사해 Next 규칙 부재 등의 오류를 냈다. 파일을 삭제하거나 규칙을 완화하지 않고 android/**/build/** 및 ios/build/**를 제외한 실제 소스를 별도 검증했다. 원래 명령의 실패와 소스 검증 결과를 구분한다.
- Mobile 관련 변경 소스 lint는 오류·경고 없이 통과했다. 전체 소스 범위는 오류 0/경고 92, Web은 오류 0/기존 경고 2다. Backend 기존 인증서 API·테스트 nullability 등의 경고는 변경하지 않았다.
- 첫 Web 빌드는 기존 .env.local의 로컬 API 설정을 읽었다. 이를 PROD 설정 검증으로 사용하지 않는다. 파일을 수정하지 않고 정상 Azure 관리 컨텍스트에서 API/Entra 등의 공개 설정만 읽어 로컬 빌드 프로세스에 명시한 PROD 빌드를 별도로 실행했다. 비밀값과 서비스 자격정보를 조회하지 않았다.
- 실제 Android/iOS 기기에서 이 변경의 UI·스토어 관리 이동·재동의를 실행하지 않았다. iOS Native 빌드는 Windows에서 실행하지 않았다. 기존 결제·DB 감사 및 SQL Integration은 반복하지 않았다.

## 배포 전 BLOCKER / 승인 필요

1. **PROD 현재 동의 버전 2026-10-14와 기존 공개 전문 2026-10-25의 대응.** 이번 코드가 2026-10-14에 2026-10-25 본문을 붙여 동의시키지는 않는다. 현재 설정 그대로 배포하면 미등록 버전의 신규 동의는 막힌다. 승인된 해당 버전 원문을 확보하거나 별도 승인된 약관/버전 전환을 준비해야 한다. 이번에는 어느 쪽도 임의로 확정하지 않았다.
2. **구형 클라이언트.** 새 프로토콜은 해시·언어·연령 확인이 없는 요청을 거절한다. 기존 Android 42/iOS 11의 동의 재요청 호환성을 당연히 가정할 수 없다. 새 클라이언트 확보와 실제 설치 가능한 지원 버전 정책, API/Web의 배포 순서를 별도 승인받아야 한다. 이번에 버전 코드나 최소 지원 버전을 바꾸지 않았다.
3. **언어별 법적 승인.** 비한국어 원문 대체 동의 또는 승인된 번역 전문의 허용 정책은 확정되지 않았다. 현재는 동의를 차단한다. 멤버십 개정 초안, 시행일, 동의 버전, 고지 기간, 법적 효력이 있는 번역 및 동의 증거 보관은 법률/원어민 승인이 필요하다.
4. **실기기 확인.** Android/iOS의 로그인 유지, 동의 필요 상태, 문서 실패, 기존 구매 상태/복원, 두 스토어 이동, 작은 화면/RTL/다크모드를 확인해야 한다.

## 운영 보호와 Git

ProgramEnabled=false, 기존 회원·구독·관리자 권한, PROD DB/스키마와 실제 동의 버전을 변경하지 않았다. 마이그레이션·새 패키지·Native 의존성 추가 없음. 실제 무료 체험 지급·결제·배포 없음. 개발 검증 당시에는 Commit/Push하지 않았으며, 이후 사용자가 최종 검토 후 Commit/Push를 승인했다.

기존 보호 파일 3개의 크기와 SHA-256은 시작 기준과 같다. 기존 미추적 DB 감사 문서도 보존했다. 이 네 파일과 기존 테스트 로그·빌드 산출물·환경/서명 파일은 커밋 대상이 아니다. 변경 소스 및 생성 입력/출력과 테스트만 명시적으로 선택해야 한다.

fetch 후 HEAD와 origin/master는 모두 기준 SHA와 같고 ahead/behind=0/0이다. 이번 작업 파일은 수정 39개·신규 14개, 총 53개다. 별도로 기존 미추적 4개가 남아 있고 staged는 없다. 민감정보 패턴 검사에서 새 비밀값은 발견하지 못했다. 생성 번역 파일의 password UI 문자열 오탐은 모두 기존 HEAD와 동일한 값임을 확인했고 원문 값을 출력하지 않았다.

권장 커밋 분할: (1) Backend 게시 문서 계약·버전 독립 연령 확인·기존 구독 보호 API 및 단위 테스트, (2) Mobile/Web 문서 소비·동의 화면·기존 구매 관리 UI·17개 언어 안내·생성기 및 관련 테스트, (3) 이 검증/배포 조건 문서. 최종 전체 작업 트리 검증 기준이며, 중간 커밋만으로 클라이언트/서버 동시 배포가 안전하다는 뜻은 아니다.

코드 Commit/Push 승인과 PROD 배포 승인은 별개다. 위 BLOCKER가 남아 있는 동안 PROD 배포를 권장하지 않는다. 운영 적용은 확정된 본문/버전/언어/지원 클라이언트/롤백 계획을 제시한 후 별도 승인을 받아야 한다.

## 이번 작업 파일 목록 (53개)
- apps/mobile/src/i18n/locales/ar.json
- apps/mobile/src/i18n/locales/de.json
- apps/mobile/src/i18n/locales/en.json
- apps/mobile/src/i18n/locales/es.json
- apps/mobile/src/i18n/locales/fr.json
- apps/mobile/src/i18n/locales/hi.json
- apps/mobile/src/i18n/locales/id.json
- apps/mobile/src/i18n/locales/it.json
- apps/mobile/src/i18n/locales/ja.json
- apps/mobile/src/i18n/locales/ko.json
- apps/mobile/src/i18n/locales/pt-BR.json
- apps/mobile/src/i18n/locales/ru.json
- apps/mobile/src/i18n/locales/th.json
- apps/mobile/src/i18n/locales/tr.json
- apps/mobile/src/i18n/locales/vi.json
- apps/mobile/src/i18n/locales/zh-Hans.json
- apps/mobile/src/i18n/locales/zh-Hant.json
- apps/mobile/src/navigation/RootStack.tsx
- apps/mobile/src/safety/__tests__/consentDocuments.test.tsx
- apps/mobile/src/safety/__tests__/safety.test.tsx
- apps/mobile/src/safety/safetyApi.ts
- apps/mobile/src/safety/SubscriptionRights.tsx
- apps/mobile/src/safety/TermsAgreementScreen.tsx
- apps/mobile/src/safety/termsDocument.ts
- apps/mobile/src/safety/TermsUnavailable.tsx
- apps/mobile/src/safety/useTermsOnboarding.ts
- apps/web/app/(app)/AppRoot.tsx
- apps/web/app/(app)/SubscriptionRights.tsx
- apps/web/app/(app)/TermsAgreement.tsx
- apps/web/app/terms/page.tsx
- apps/web/lib/appI18nMobile.generated.ts
- apps/web/lib/appI18nMobileKeys.ts
- apps/web/lib/legalContent.ts
- apps/web/lib/publishedTerms.generated.json
- apps/web/lib/termsDocument.generated.ts
- apps/web/scripts/generateConsentDocuments.mjs
- apps/web/tests/consentDocuments.test.ts
- apps/web/tests/safety.test.ts
- apps/web/tests/webMembershipPolicy.test.ts
- backend/src/Juple.Api/Controllers/AppleBillingController.cs
- backend/src/Juple.Api/Controllers/GoogleBillingController.cs
- backend/src/Juple.Api/Controllers/SafetyController.cs
- backend/src/Juple.Api/Controllers/SubscriptionManagementController.cs
- backend/src/Juple.Api/Controllers/TermsDocumentController.cs
- backend/src/Juple.Api/Safety/TermsAcceptance.cs
- backend/src/Juple.Application/Juple.Application.csproj
- backend/src/Juple.Application/Safety/PublishedTerms.cs
- backend/src/Juple.Application/Safety/PublishedTerms.json
- backend/src/Juple.Application/Safety/Safety.cs
- backend/tests/Juple.UnitTests/Billing/AccessPolicyAndWriteAccessTests.cs
- backend/tests/Juple.UnitTests/Safety/SubscriptionManagementTests.cs
- backend/tests/Juple.UnitTests/Safety/TermsAndSafetyApiTests.cs
- docs/membership-consent-readiness.md
