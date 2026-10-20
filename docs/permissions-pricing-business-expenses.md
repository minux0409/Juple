# 권한 온보딩 · USD 1.99 · 사업비용 관리 (2026-10-20)

## 범위와 실행 상태

기준 HEAD `1f71382`. 최초 구현은 소스·로컬 검증·문서화로 마쳤으며, 후속 사용자 승인에 따라 최종 검토와 논리적 Commit/fast-forward Push를 진행한다. 기존 RET/iOS 코드를 보존한다. PROD DB/Blob/설정/RBAC/가격/약관을 변경하지 않았다. `Expenses:Enabled`, `Expenses:AzureSyncEnabled`, Billing 프로그램, Data Export는 기본 OFF다. RET 자동 삭제 구현·Job은 추가하지 않았다. 아래 구현과 실제 운영 활성화의 검증 상태를 구분한다.

## A. 모바일 권한

### 조사 결과

- 알림: Android manifest의 `POST_NOTIFICATIONS`만 런타임 허가 대상. 기존 FCM은 Android 전용이다.
- 사진: 설치된 `react-native-image-picker`의 Android PickVisualMedia/PickMultipleVisualMedia 및 iOS PHPicker 경로 사용. `includeExtra`를 요청하지 않는다. 컬렉션 아이콘·프로필·링크 사진 선택에 광범위한 앨범 권한이 필요하지 않다. 사용자가 선택한 사진만 다룬다.
- 카메라: 실제 촬영 진입점이 없으므로 권한을 추가하지 않는다. 최종 APK에도 CAMERA/READ_MEDIA_*/READ_EXTERNAL_STORAGE가 없다. 기존 iOS 설명 키는 시스템 권한 요청 자체가 아니다.
- 기타: 최종 APK의 INTERNET/네트워크/WAKE_LOCK/부팅 수신/foreground service/생체인식/Billing/FCM/서명 권한은 라이브러리를 포함한 기존 선언이다. 제품 소스에는 별도 생체인식 권한 요청이 없고, 최초 로그인에서 이를 추가로 요청하지 않는다. 실제 런타임 안내 대상은 알림이다.

### 동작

인증/Bootstrap/약관 동의 후 설치 단위 권한 안내를 표시한다. 허가와 무관하게 계속/나중에 설정으로 Home에 진입한다. 기존 설치에서 안내 기록이 없으면 한 번 표시한다. 이후 내 페이지의 권한 설정에서 상태·복구 경로를 제공한다. 계정을 바꿔도 안내 기록은 유지하되 권한 판정에는 쓰지 않는다. 새 설치/저장소가 비어 있으면 다시 안내한다. 백업 복원 시 안내 기록이 복원될 수 있으므로 실제 권한은 항상 OS에서 확인한다.

Android 네이티브 브리지는 API 33 런타임 권한과 앱 전체 알림 스위치를 함께 읽는다. API 32 이하에서 차단된 알림은 설정 앱으로 안내한다. iOS는 UNUserNotificationCenter 설정 및 명시적 요청을 사용하며 authorized/provisional/ephemeral을 허가 상태로 취급한다. **APNs 등록·배송은 구현하지 않았으며 화면에서도 미지원이라고 표시한다.**

권한 요청은 사용자가 버튼을 누를 때만 수행한다. 이미 허가된 상태에서는 시스템 요청을 생략한다. 설정 앱에서 돌아올 때 상태를 새로 읽는다. 17개 locale에 실제 안내 번역을 추가했다. 기기별 줄바꿈/RTL 및 번역 검수는 실기기 QA 항목이다.

### Android 토큰 복구

Bootstrap, 언어 변경, foreground 복귀, FCM 토큰 갱신에서 OS 상태 → 현재 토큰 → 서버 PUT을 수행한다. 거부, 상태 조회 실패, 토큰 없음, 토큰 조회 실패, 서버 등록 실패, 등록 확인을 구분한다. 일시 실패는 foreground에서 15/60/180초로 최대 3회 재시도하며 수동 재시도도 제공한다. 효과 해제/계정 변경 시 타이머와 구독을 정리한다.

진행 중 PUT과 로그아웃 unregister를 직렬화한다. 로그아웃 epoch 이후 획득된 옛 토큰은 등록하지 않는다. 진단에는 상태·시각·HTTP status만 남기며 토큰·설치 ID·사용자 ID·원본 예외·응답 본문을 기록하지 않는다. 네트워크 단절 중 unregister는 기존 best-effort 정책이며 서버의 신뢰 가능한 세션 폐기를 새로 구현한 것은 아니다. RET-03-S는 그대로 차단 상태다.

## B. 가격 정책과 외부 확인

- 사업 정책의 코드 기준: `SubscriptionPricingPolicy`의 USD 1.99 / P1M / 30일. Admin 설정 응답에도 같은 값을 제공한다.
- 결제 화면의 유일한 가격 출처는 스토어의 localizedPrice/currency metadata다. 정책 상수를 결제 가격 fallback으로 사용하지 않는다. Web의 결제 미지원, iOS StoreKit 미구현 상태도 유지한다.
- `USD 0.99` 사업 문서 두 곳을 갱신했다. `₩1,300`, `$0.99`는 기존 store-metadata 전달/서로 다른 통화 표시를 검증하는 테스트 fixture에만 남는다. 실제 UI의 고정 결제 가격이 아니다.
- 30일 Juple 체험·월간 자동 갱신·RET 6개월 정책과 Billing OFF 동작을 변경하지 않았다. 스토어 체험 offer를 추가하지 않는다.
- 기존 DEV 문서의 상품은 `juple_monthly` / `monthly`. 이는 이번 라운드의 실시간 스토어 카탈로그 확인을 대체하지 않는다.
- 로컬 API user-secrets에는 Play 조회 credential/product 설정이 없었다(값은 출력하지 않음). 연결 가능한 브라우저의 Play Console URL은 공개 사업 소개 페이지로 이동하여 인증된 관리 화면을 읽지 못했다. App Store Connect의 인증된 카탈로그도 확인하지 못했다. 실제 판매국가·현재 가격·기존 구독 cohort는 **미확인**이다.
- Google의 공식 `convertRegionPrices`는 androidpublisher 인증이 필요하다. Apple 공개 KRW 구간만으로 Juple 월 구독의 실제 원화 가격을 결정할 수 없다. 따라서 **공식 상품별 KRW 제안은 보류**하고 임의 환산 결제 가격을 표시하지 않는다.

### 실제 가격 변경 전 승인 자료

Play Console/API에서 package/product/base-plan, 상태, 판매국가, 지역별 현재 가격, legacy cohort를 읽고 USD 1.99의 공식 지역 가격 변환 결과(KR 포함)를 보관한다. App Store Connect에서는 월 구독 상품/구독 그룹/판매 지역/한국 price point와 현지화 가격을 확인한다. 각각의 기존 가입자 가격 보존 또는 인상 방식, 지역별 동의·고지 요구, 적용일을 먼저 보고한다. 이 보고와 별도 승인 전에는 상품 가격/판매/Billing/Terms/Privacy를 변경하지 않는다.

## C. 사업비용 구현

### Admin

`/expenses` 메뉴를 기존 Admin shell/Owner·Admin 정책에 추가했다. 월/연/기간 필터와 카테고리·결제수단·공급자·통화·상태·환경·서비스 필터, 비용 목록/상세/등록/수정/삭제, 통화·상태별 합계, 월별 추이와 분류/서비스별 차트, 반복 예정, 마지막 동기화 결과, CSV/XLSX, 증빙, 삭제된 비용을 포함한 ID별 감사 이력을 제공한다. 모바일 폭에서는 폼을 접고 표만 내부 스크롤한다.

서버가 활성화되지 않으면 비활성 상태를 설명하고 장부 조회/변경을 하지 않는다. 브라우저는 ARM 자격 증명을 받지 않는다. 운영자 결제 내역이므로 일반 사용자의 컬렉션/메모/사진을 장부 API에서 읽지 않는다. 전용 구독 만료 예외는 기존 Admin 정책과 동일하고 관리자 grant 검사를 우회하지 않는다.

### 장부/정합성

5개 admin 테이블: Expenses, ExpenseRecurringSchedules, ExpenseAttachments, ExpenseAuditLogs, ExpenseSyncRuns. 금액/환율은 decimal(28,12), 통화는 원본 3자리 코드, 회계일은 DateOnly, 이벤트 시각은 UTC다. 상세 금액은 JSON decimal 문자열로 전달하여 편집 시 JS 부동소수점 절삭을 피한다. 차트는 표시용이고 원본 정밀도는 CSV/XLSX에서 보존한다.

- net+tax=gross 정확 일치. 미확인 세액과 0원을 구별한다. 통화/결제 상태를 합산하지 않는다. 환산 원금·통화·환율·기준일을 보관한다.
- 요청 UUID와 정규화한 공급자/통화/청구서 번호의 unique key로 중복 방지. revision으로 오래된 편집을 거부한다.
- 환불은 원본 결제 완료 charge와 동일 통화·음수여야 하고, 누적 환불이 원본을 넘을 수 없다. 관련 환불이 남아 있으면 원본 취소/삭제/과도한 감액을 막는다. 취소 내역은 합계에서 제외한다.
- 반복 생성은 일정 행 잠금+예정일 key로 중복 방지. 말일/윤년 anchor 유지. 생성물은 반드시 추정/미결제이며, 실제 결제 완료는 운영자가 처리한다. 1회 호출 일정 100개×각 24회로 제한하고 다음 호출에서 이어간다. 일정에는 다음 생성일을, 별도 결제 확인 알림에는 지난 예정일/30일 이내의 미확인 수동·반복 비용을 표시한다. 미리 생성해 일정 커서가 넘어가도 미확인 결제 알림은 유지되며 Azure 사용량은 결제 알림에서 제외한다. Apple 연회비는 수동 등록이며 Apple 청구 자동 API 연동을 주장하지 않는다. 외부 예정 알림 발송은 미구현이다.
- 수정/삭제/증빙/수집/대사 전후 기록을 같은 SQL transaction의 감사 이력으로 남긴다. soft delete와 감사 원본을 보존한다.

### Azure

기존 Azure.Identity DefaultAzureCredential/Managed Identity 체인을 사용한다. 서버 설정의 명시적 Juple RG scope만 허용한다. API 2025-03-01 ActualCost Query를 일별×ServiceName으로 읽어 구독/RG/환경/서비스/통화를 보존한다. ARM redirect와 외부/다른 scope nextLink는 거부하고, 페이지·행·본문·시간을 제한한다. 429/503은 제한된 Retry-After 재시도 후 실패 상태를 기록한다.

scope+month DB 잠금/5분 lease로 동시 수집을 막는다. scope/date/service/currency key로 갱신하고 사라진 행은 이력을 유지하며 집계에서 제외한다. 실패한 부분 응답은 snapshot에 반영하지 않는다. 정밀 원본 금액도 별도 보존한다. 최종 세액·크레딧을 추론하지 않고 **Estimated / tax unknown**으로 수입한다. 실제 Microsoft Azure 청구서를 수동 Paid로 등록하고 대응 사용량 ID를 대사하면 추정액을 중복 합산하지 않는다. 재수집으로 대사 연결을 덮어쓰지 않는다.

`--run-expense-sync`는 기존 one-shot 구조의 소스 진입점이다. 기본 OFF. 활성화 시 예정 30일, 설정 scope의 현재·전월 비용 재수집, abandoned 증빙 cleanup을 수행한다. 총 20분 제한. **Job·스케줄러·유료 리소스는 만들거나 배포하지 않았다.** 승인 후 실제 운영 배치 주기/실패 알림을 구성해야 한다.

읽기 관측: 2026-10-20 CLI 현재 계정으로 rg-juple-prod 104행, rg-juple-dev 139행의 MonthToDate Query가 성공했고 둘 다 KRW였다. 이는 확정 청구서 금액/전체 구독 비용 확인이 아니다. 알려진 Juple identity RG들도 운영 설정의 scope 선정 시 포함 검토한다. API UAMI의 해당 RG 직접·상속 role assignment 조회 결과는 비어 있었다. 그룹/상위 계약 권한이나 실제 UAMI token으로의 Cost Query 성공은 검증하지 않았다. CLI 사용자 성공을 서버 권한 성공으로 주장하지 않는다. 승인 요청은 필요한 Juple RG에 한정한 Cost Management Reader 우선이며, 실제 거부/계약 종류를 확인해 최소 권한을 결정한다. 공유 UAMI를 쓰는 다른 앱의 권한 확대 영향도 검토한다. 이번에는 RBAC를 바꾸지 않았다.

비용은 통상 8–24시간, 일부 구독 유형 최대 72시간 지연되고 청구 마감 전 정정될 수 있다. 운영자는 확정 invoice와 대사해야 한다.

### 증빙·내보내기·세무 범위

PDF/PNG/JPEG, 확장자와 magic 일치, 10 MiB, 이미지 실제 decode/16MP, ClamAV INSTREAM 검사를 통과해야 업로드한다. scanner 미설정/장애/불명확 응답은 차단한다. 암호화 PDF는 거부하고, 실제 daemon에도 암호화/한도 초과를 clean으로 처리하지 않는 설정 검증이 필요하다. 원본 bytes/SHA-256을 보존하며 이미지를 재압축하지 않는다.

별도 private `expense-evidence` Blob 컨테이너를 사용한다. SAS나 공개 URL을 반환하지 않는다. Owner/Admin 재확인→해당 비용/첨부 ID/상태 검증→인증 API 다운로드만 허용하며 attachment disposition, no-store/no-referrer/nosniff를 적용한다. DB Pending/Available/CleanupPending/Deleted로 중단된 업로드를 추적한다. 비용 삭제와 완료 처리를 같은 비용 행 잠금으로 직렬화한다. 삭제는 접근을 먼저 차단하고 Blob cleanup을 재시도 가능하게 남긴다. multipart 바인딩 전부터 파일 응답 완료까지 replica당 동시 4개, 처리 작업 별 동시 2개, 파일/수집/내보내기 시간·크기 제한을 둔다.

CSV 수식 입력을 보호하고 실제 Office Open XML ZIP(.xlsx)을 생성한다. 텍스트는 formula가 아닌 inline string이며 Excel 15자리 정밀도를 넘는 값은 텍스트로 보존한다. 기간 최대 1년/내보내기 10,000행. 증빙 ID/파일명으로 원본과 연결한다. 개인정보/세법상 비용 인정·공제 가능 여부를 자동 판정하지 않는다. 세무사 검토를 위한 원본과 이력을 제공한다.

## 로컬 실행과 운영 활성화 구분

신규 `20261020110000_AddBusinessExpenses`는 기존 마지막 Migration 뒤에 배치했다. Up은 새 admin 테이블·제약·인덱스만 추가한다. 기존 RET/user/content 테이블의 데이터를 수정하지 않는다. `infra/local/Test-Retention.ps1 -Filter 'FullyQualifiedName~Expenses'`는 localhost,14333/JupleRetTests 및 UseDevelopmentStorage=true만 허용한다. SA 암호는 기존 환경 변수에서 읽고 출력하지 않는다. 테스트의 clean scanner는 명시적 fixture이며 실사용 검사기로 등록되지 않는다.

승인 후 환경별 설정 예(아래는 예제이며 실제 적용하지 않음):

```json
{
  "Expenses": {
    "Enabled": true,
    "AzureSyncEnabled": false,
    "AzureScopes": [
      { "Scope": "/subscriptions/<id>/resourceGroups/rg-juple-dev", "Environment": "DEV" },
      { "Scope": "/subscriptions/<id>/resourceGroups/rg-juple-prod", "Environment": "PROD" }
    ],
    "ClamAvHost": "<existing-private-scanner-host>",
    "ClamAvPort": 3310
  }
}
```

`<id>`/host는 검증된 운영 값으로 교체해야 한다. 클라이언트가 scope/credential을 설정하거나 보낼 수 없으며 수동 sync는 등록된 scope만 선택한다. 신규 리소스/MI 역할/Job/배포/PROD Migration/스토어 가격 변경/청구 활성화는 각각 별도 승인이다.

## 검증과 남은 QA

최종 실행 결과는 아래 표와 Release Backlog를 함께 확인한다. skip/전역 timeout 증가로 실패를 숨기지 않는다.

| 검증 | 결과 |
|---|---|
| Backend build/unit | PASS; 최종 검토 Unit 2,092/2,092, skip 0 (기존 테스트 warning은 유지) |
| Backend Integration | 구현 단계 전체 966/966 PASS (15분 1초); 최종 검토에서 새 환산 테스트 포함 비용 전체 8/8 재확인 PASS, skip 0 |
| Admin tests/Chrome workflow | 총 49/49 PASS, skip 0; 실제 Chrome workflow 포함 (합성 API) |
| Admin typecheck/lint/build | PASS; typecheck/lint 오류·경고 0 |
| Mobile 전체 Jest | 202 suites / 3,012 tests PASS; 기본 5초 timeout (314.5초) |
| Mobile 권한/FCM 재검증 | 최종 검토 5 suites / 25 tests PASS; 거부/나중에/오래된 등록 방지/재시도 포함 |
| Mobile typecheck/lint | PASS; 변경 파일 lint 오류·경고 0 |
| Android | DEV dogfood arm64 build PASS (최종 2분 55초); 설치/실기기 QA 미실행 |
| Web | 전체 841 tests PASS |
| iOS | 소스/프로젝트 등록만; Mac Xcode 빌드와 기기 QA 필요 |

남은 항목: 실제 Android/iOS 알림 거부/재허가·재설치·계정 전환·FCM 수신 QA, iOS APNs 별도 구현, 17개 언어 기기 QA, 인증된 Play/App Store 카탈로그·KRW price point와 기존 cohort 확인, MI 비용 조회 및 최소 RBAC 승인, 실제 malware daemon/EICAR·암호화/scan-limit 검증, 실제 Admin/API/Azure 환경의 최종 E2E, 반복 예정 외부 알림/운영 배치와 실패 알림. RET 출시 차단 항목은 그대로 유지한다.

## 공식 근거 (확인일 2026-10-20)

- [Android Photo Picker](https://developer.android.com/training/data-storage/shared/photopicker): 선택한 미디어 접근, 광범위한 저장소 권한 대체.
- [Apple 알림 허가](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications): 허가 요청과 설정 조회.
- [Google 지역 가격 변환 API](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization/convertRegionPrices): 인증된 지역 가격 계산; Juple 상품 결과는 미조회.
- [Google 구독 가격 변경](https://support.google.com/googleplay/android-developer/answer/12154973): 기존 가격 cohort·고지·동의 영향 확인.
- [Apple 월 구독 가격 관리](https://developer.apple.com/help/app-store-connect/manage-subscriptions/manage-pricing-for-auto-renewable-subscriptions/): 구독별 가격/기존 가입자 영향 확인.
- [Apple 공개 IAP 가격 구간](https://developer.apple.com/in-app-purchase/): 일반 KRW 구간을 Juple 월 구독 확정 가격으로 간주하지 않음.
- [Azure Cost Query](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage?view=rest-cost-management-2025-03-01), [데이터 지연](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/understand-cost-mgt-data), [조회 scope/권한](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/understand-work-scopes).

## 변경 파일 및 Git 보존

최초 구현 종료 및 최종 검토 시작 HEAD는 `1f71382`다. 시작 시 tracked 44개 + 신규 소스/문서 30개를 모두 확인·보존했다. 기존 보호 파일 `unit-test-diag.log`는 별도 untracked 상태로 유지하며 stage하지 않는다. 보호 파일 SHA-256은 `A9FEFCC27B8D2C861F950526FFACFAA801D13D6C75311F82C45ADC6220135CFE`다. `logcat-r35a-final-polish-samsung.txt`는 처음부터 없었으며 생성하지 않았다. 최종 검토 시작 시 fetch한 `origin/master`는 기준 HEAD와 일치했다. Push 직전에도 원격 기준을 재확인하며, 원격이 달라지면 중단한다.

주요 변경 파일:

- Mobile: `src/permissions/*`, `src/push/*`, `RootStack.tsx`, `MyPageScreen.tsx`, 17 locale JSON, Android `JupleNotificationPermissionsModule.kt`/패키지 등록, iOS `.mm`/프로젝트 등록.
- 가격: `SubscriptionPricingPolicy.cs`, `docs/architecture.md`, `docs/google-play-billing-setup.md`.
- Backend 장부: Domain/Application/Infrastructure의 `Expenses/*`, `AdminExpensesController.cs`, DI/DbContext/RateLimitPolicies/Program, EF configuration·신규 Migration·snapshot, Unit/Integration tests.
- Admin: `app/(admin)/expenses/page.tsx`, `lib/expenses.ts`, API client·navigation·strings·공통 CSS, 모델/API 및 실제 Chrome 테스트.
- 테스트 안정화: `CollectionDetailsBrowsing.test.tsx`의 3개 view를 각각 전체 canonical 순서와 비교한다. 첫 재실행에서 합쳐진 3-mode 테스트가 5초 초과 후 다음 renderer 수명에 영향을 주었고, 분리한 33개 테스트는 기본 5초에서 전부 통과했다. skip/전역 timeout 증가는 없다. 기존 act warning을 무조건 숨기는 console mock을 추가하지 않았다.
- 문서: 이 보고서 및 `RELEASE_BACKLOG.md`.

신규 Migration의 SQL을 별도 설계 factory로 생성해 5개 CREATE TABLE과 migration-history INSERT 외 기존 데이터 변경이 없음을 확인했다. PROD DB에 연결하지 않았다. Backend에서 보이는 기존 nullable/xUnit/analyzer warning은 이번 변경으로 숨기지 않았다.
최종 APK: `apps/mobile/android/app/build/outputs/apk/dogfood/app-dogfood.apk`, 40,463,889 bytes, package `com.juple.app`, versionCode 31. Metro dogfood 설정과 `JUPLE_PUBLIC_WEB_HOST=dev.juple.co.kr`로 빌드했다. 같은 package 이름의 Play 배포 앱과 서명이 다를 수 있으므로 이번 라운드에서는 어느 기기에도 설치하지 않았다. 최신 Admin build도 PASS하며 비용 알림 UI를 포함한 전체 49개 테스트가 다시 통과했다. 최종 `git diff --check`와 신규 30개 텍스트 파일의 trailing-whitespace 검사도 PASS다.

## 최종 소스 검토

- 최초 로그인/약관 완료 후 권한 안내를 표시하며, 거부·나중에·저장 실패에도 Home 진입을 막지 않는다. OS 상태와 설명 완료 마커는 별개다. 실제 기기 QA는 PERM-01/02에 남는다.
- Android FCM 등록/토큰 갱신/foreground 복구/한정 재시도/로그아웃 직렬화의 집중 회귀 테스트를 다시 통과했다. iOS 권한 허용을 APNs 구현 완료로 취급하지 않는다.
- USD 1.99는 사업 기준값이다. 기존 USD 0.99/KRW 1,300 테스트 fixture는 스토어 메타데이터 표시를 검증하며 판매 가격을 지정하지 않는다. 스토어 설정과 Billing 설정은 변경하지 않았다.
- Admin HTTP 정책과 서비스의 active Owner/Admin 재확인을 검토했다. 증빙 검사기 미설정 시 업로드 서비스에서 DB/Blob 접근 전에 거부하는 테스트를 추가 확인했다.
- 반복/환불/수동-Azure 조정 기존 테스트와 함께 정상 환율의 SQL decimal 왕복, 원래 통화별 집계 유지, CSV/XLSX 환산값·환율 기준일·고정밀 보존 테스트를 보강했다. 신규 CSV 테스트의 최초 기대값에서 따옴표 누락을 수정했고 전체 Unit을 재통과했다.
- DB에 접속하지 않는 설계 factory로 `dotnet ef migrations has-pending-model-changes` PASS. 신규 Migration은 localhost 전용 테스트 DB에만 적용했다.
- Backend와 Azure 수집기는 같은 저장소·lease·트랜잭션 계약으로 결합되어 있어 하나의 빌드 가능한 기능 커밋으로 관리한다. 권한/FCM, 가격 정책, Admin UI, 테스트 안정화/문서는 별도 단위다.
- Azure API MI 실제 권한, 실제 malware engine, 실기기 QA, iOS Native/APNs, 판매 카탈로그 확인은 출시 차단 상태다. 소스 Push는 이들 기능의 활성화 승인이 아니다.
