# API 요청 제한 및 자원 보호 — 2026-10-21

## 범위와 작업 상태

- 시작 기준 및 최종 검증 전 fetch 결과: `master`, HEAD = origin/master = `e9f7e10b811d74afb2483d505e2cbbbcc1178327`, ahead/behind 0/0.
- 시작 시 untracked는 보호 파일 `unit-test-diag.log`뿐이었다. APNs Backend는 기준 커밋에 포함되어 있다.
- 소스와 로컬 테스트를 검증하고 사용자 승인에 따라 이 문서의 67개 경로를 명시해 Commit/Push하는 라운드다. PROD API 요청·DB·Blob·설정·배포, Azure 리소스 생성/변경은 하지 않았다. Azure 조회는 활성 revision/이미지 태그/안전한 기능·버전 설정만 읽기 전용으로 수행했다.
- 신규 Migration은 없다. 기존 localhost SQL Server/Azurite만 테스트에 사용한다. Billing/Export/RET 활성화 변경은 없다.
- **메모리 요청 제한과 semaphore는 모두 Replica 단위다.** 아래 180/분은 서비스 전체의 정확한 계정 quota가 아니다.

## 1. 실제 클라이언트 호출 계산

다음은 현재 코드의 분기와 API 호출을 세어 계산한 값이다. PROD/실기기 트래픽 계측이나 부하 테스트 수치가 아니다. Entra/MSAL/FCM 자체 통신은 Juple API 요청 수에 포함하지 않는다.

| 사용자 동작 | Juple API 호출 계산 | 근거 / 병렬성 |
|---|---|---|
| Mobile 로그인 후 Home | 세션 확인 1 + bootstrap 1 + Terms 조회 1 + Home 목록/개수 2 + unread 1 = 기본 6. 알림 허용 시 등록 0–2, 약관 동의가 필요하면 쓰기 1 추가 | `auth/authSessionApi.ts`, `auth/userBootstrapApi.ts`, `safety/useTermsOnboarding.ts`, `DailyInboxScreen.tsx`, `push/usePushRegistrationSync.ts`, `push/pushPermissionFlow.ts`. Home 목록/개수는 병렬 |
| Android 재실행 / iOS 세션 복원 | 유효한 저장 세션이면 위와 같은 API 확인 경로. Entra 토큰 갱신은 별도. iOS APNs 미준비 상태에서는 등록 API 없음 | `AuthContext.tsx`, `push/fcmPlatform.ts`. 이 라운드에서 iOS Native/APNs 구현 상태는 바꾸지 않음 |
| Mobile 단순 Home 재조회 | 목록 1 + count 1. 새 페이지는 목록 1 | `DailyInboxScreen.tsx`, 목록 기본 25, 선택에 따라 50/100 |
| 링크 1개 검토·저장 | 목적지 목록 P회(보통 1) + metadata 1 + Inbox 1 + title/memo 0–1 + 자동 preview 0–1 + Home 목록/count 2. 보통 5–7, Instagram device 후보 preview/apply가 있으면 최대 2 추가 | `NewLinkReviewScreen.tsx`, `inbox/api/inboxApi.ts`. 선택한 컬렉션마다 쓰는 것이 아니라 Inbox 요청 1개로 전달. Picker 다음 페이지는 P에 추가 |
| 링크 5–10개 연속 | 위 경로 반복. 10개면 보통 50–70, 후보 처리 포함 약 90 + picker 추가 페이지. 링크/metadata 버킷은 각각 10회 | 검토 후 저장하므로 보통 순차. 검토 metadata가 끝나기 전 저장해도 계정 동시 2 허용 |
| URL 미리보기 | resolve 1; Instagram candidate preview는 별도 0–1 | `urlMetadata/api/urlMetadataApi.ts`, 후보 preview도 metadata 버킷에 포함 |
| 컬렉션 목록 | 선택 scope 첫 페이지 1 + 추가 페이지마다 1; 다른 tab/검색으로 바꾸면 그 scope 조회 | `CollectionsScreen.tsx`, 페이지 24, 선택에 따라 48. 즐겨찾기/owned/shared를 행동 하나당 무조건 하나로 계산하지 않음 |
| 컬렉션 상세 | 기본 정보 1 + 날짜 sections 1 + 펼친 section 페이지 수 E. 협업이면 participants 1, 알림 preference 1, 읽음 쓰기 0–1이 추가될 수 있음 | `CollectionDetailsScreen.tsx`, `useCollectionItems.ts`. 이름순은 100개씩, 최대 500개까지 5회 읽기 후 로컬 정렬 |
| History 빠른 스크롤 | sections 1 + 펼친 section의 최초/추가 페이지마다 1; 25개 기준 1,000개는 40페이지 | 날짜별 in-flight/페이지 가드가 있음. 날짜 펼침 수에 따라 병렬 조회 가능 |
| 검색 입력 | debounce로 확정된 검색어마다 첫 페이지 1, 다음 페이지마다 1. 빠른 키 입력 전체를 글자 수만큼 세지 않음 | `DateHistoryScreen`/`CollectionDetails` 검색 테스트, 기본 검색 페이지 30. 느리게 입력하면 여러 검색 발생 |
| 친구 / 초대 / 댓글 / 반응 | 친구 목록 1 + 요청 목록 1; 변경 1 이후 목록 갱신 1–2 가능. 댓글 첫 페이지 1, 반응/댓글 쓰기 각 1 | `FriendsScreen.tsx`, 협업 API/화면. 친구 목록과 요청 목록 병렬. 기존 초대/ID lookup 제한 별도 유지 |
| 알림 목록 / 읽음 | 목록 페이지 1, 읽음/모두 읽음 각 1. 응답 unread 값을 사용하며 오류/삭제 경쟁 시 재조회 1–2 가능 | `notifications/useNotificationInbox.ts`. Web bell은 15초 최소 refresh 간격 |
| 프로필 / 설정 | MyPage profile 1 + 친구 요청 1. 편집/사진/설정 변경당 해당 쓰기 1. Billing catalog는 기존 독립 제한 | `MyPageScreen.tsx`, `UserProfileController` |
| 앱 shortcut 복원 | pinned 없으면 0. 있으면 50개씩, 모두 찾거나 cursor 끝까지 S회 추가 | `categories/collectionShortcutSync.ts`. 큰 계정의 전체 순회는 제한을 만날 수 있어 별도 위험으로 남김 |
| Web 로그인 + Home | bootstrap 1 + profile 1 + Home 목록/count/summary 3 + unread 1 = 기본 6 | `AppRoot.tsx`, `HomeView.tsx`. Home의 3개 조회가 겹칠 수 있음 |
| Web 공개 공유 | Collection 1, 읽을 수 있는 public share이면 items 1. 이후 페이지당 1. 잠금/비공개면 items는 호출하지 않음 | `lib/shareView.ts`, `lib/publicApi.ts`. SSR와 브라우저 페이지 요청을 모두 고려 |
| 네트워크 재시도 | Mobile GET 전송 실패만 최대 2회(8초/회, 사이 1초). Web는 전송 자동 재시도 없음. 모두 401일 때만 fresh token 1회 재시도 | `apiClient.ts`, `authenticatedApiClient.ts`, `appApi.ts`. **429 자동 재시도 0회**, 쓰기 자동 재전송 없음 |

자동 admission 테스트는 시작/복원, 링크 10개와 title/preview/목적지/Home 후속 요청, 추가 목록/검색/스크롤 40회, 이미지 10회, 컬렉션 생성 10회, 사회적 쓰기 20회, push 4회, unlock 10회를 같은 계정의 한 window에 넣는다(166회). 실제 MVC descriptor 분류도 검증한다. 이는 실제 UI E2E를 했다는 뜻은 아니다.

## 2. 기본 정책

`backend/src/Juple.Api/appsettings.json`의 `RequestProtection`과 `Configuration/RequestProtection.cs`. 환경별 별도 DEV 정책은 추가하지 않았다. 값은 시작 시 검증하며 서버 설정 변경과 API 재시작(새 revision)이 필요하다. Android/iOS/Web 앱 재배포는 필요 없다. 예: `RequestProtection__AccountPerMinute=240`, `RequestProtection__ReadPerMinute=160`. Hot reload는 구현하지 않았다. 기존 named policy의 고정값과 실제 hasher의 안전 상한 2는 그대로 유지한다.

| 새 정책 | 기본값 / Replica | 근거 |
|---|---|---|
| 인증 계정 전체 | 180/분 | 단일 저장의 후속 쓰기/조회와 여러 화면 병렬 호출을 포함. 제시된 120보다 여유를 둠 |
| GET/HEAD 조회·검색 | 120/분 | 25개 페이지 스크롤, 날짜 sections, Home 병렬 요청과 다른 기기 동시 사용 고려 |
| Inbox 저장 / metadata | 각각 30/분 | 검토 및 5–10개 연속 저장, device 후보 preview 여유. 둘은 독립 빈도지만 metadata 동시성은 공유 |
| 이미지 업로드 | 15/분 | 여러 장 순차 저장 및 profile/icon 변경. 삭제는 업로드 버킷에서 제외 |
| 컬렉션 생성 | 15/분 | 정상 정리 작업 여유, 자동 반복 생성 억제 |
| 댓글·반응·친구/초대·알림 쓰기 | 40/분 | 한 번의 변경 후 읽기 refresh는 조회 버킷. 기존 더 엄격한 초대/신고 제한 유지 |
| Push 등록(PUT) | 10/분 | 최초 허용/복원/언어 변경/foreground/token 회전, 최대 3회 후속 재시도 고려. Logout 해제(DELETE)는 계정 전체 제한만 적용해 등록 burst와 분리 |
| copy/merge/undo/휴지통 비우기 | 5/분 | 한 요청이 수백 행을 처리할 수 있음 |
| 공유 비밀번호 설정/삭제 및 계정 lock 설정 | 5/15분 | 해싱·민감 변경 억제. 기존 계정 lock 정책 유지 |
| 인증된 비밀번호 검증/잠금 해제 | 30/분 | 여러 정상 컬렉션을 여는 행위에 설정용 5/15분을 적용하지 않음. 기존 endpoint 10/분 및 SQL 실패 제한 별도 |
| Admin 전체 | 60/분 | JWT 인증 후, active-admin 권한 DB 조회 전에 거부 |
| 익명 전체 / 공개 GET | **기본 OFF** (`AnonymousIpLimitsEnabled=false`), 켜면 IP당 300/분 / 240/분 | 실제 ACA 사용자 IP를 검증하지 못한 상태에서 공유 Ingress/NAT 전체를 차단하지 않도록 결정. 켠 상태의 XFF 위조/IPv6 정규화도 테스트 |

- 인증 키: 검증된 authenticated principal의 Guid `tid + oid`, 정규화된 동일 키. 플랫폼/헤더/토큰 문자열로 서버 bucket을 나누지 않는다.
- 익명 키: `Connection.RemoteIpAddress`. IPv4-mapped IPv6는 IPv4로, 일반 IPv6는 /64로 정규화. **X-Forwarded-For를 읽어 신뢰하지 않는다.** 공유 peer라면 방문자가 예산을 공유한다. 따라서 새 익명 IP fixed-window 제한 전체(익명 Admin category 포함)는 기본 OFF다. 기존 공개 unlock named policy, SQL 실패 bucket, 실제 hasher 동시 2 상한은 계속 적용한다. 익명 공개 조회에 새 요청 수 방어가 없다는 잔여 위험은 배포 전에 검토해야 한다.
- Health, AppUpdate, Google RTDN은 새 전역 admission에서 제외. RTDN의 Google OIDC 검증과 기존 Export download 제한은 유지.
- 모든 기존 named policy(Billing 60/시간, Export 10/분/4 stream, ID lookup, lock, public unlock/write, invite, report, block, support, expense files)는 그대로 추가 적용된다. 체인 앞의 window는 뒤의 제한에 거부되더라도 이미 사용될 수 있다.
- `Enabled=false`는 **새 HTTP admission**을 해제한다. 기존 정책, 안전 크기 제한, 이미지 timeout, 실제 outbound/hasher 안전 상한은 유지한다. 보안 경계를 한 번에 모두 끄는 스위치가 아니다.

## 3. 비용이 큰 작업과 오류

| 대상 | 구현 / 범위 |
|---|---|
| HTTP metadata/Inbox | 계정 동시 2, Replica HTTP 동시 4, 대기 0. MVC/권한 DB 전에 획득 |
| 실제 metadata outbound | DI singleton 동시 4, 대기 0. typed HttpClient 및 retry caller가 공유. cache hit 뒤, 외부 HTTP 앞에서 획득. SSRF/DNS/redirect/8초+6초 budget은 변경 없음 |
| 동일 URL 중복 | 기존 500-entry/10분 결과 cache 유지. **일반 URL in-flight 합병은 추가하지 않았다.** waiter 취소 및 Job 수명 분리 설계가 필요. 같은 URL의 동시 cache miss 최대 4개는 여전히 가능 |
| Inbox request ID | SQL replay/conflict 확인을 metadata 앞으로 이동. 같은 Replica의 `(userId, requestId)` 직렬화: 최대 64개 key, key당 active+waiter 4, 취소 시 정리. 다른 Replica와의 저장 무결성은 기존 SQL unique ledger가 보장. SQL transaction을 외부 HTTP 동안 잡지 않음 |
| Inbox 분산 한계 | 다른 Replica의 같은 request ID는 동시에 metadata를 조회할 수 있다. 저장 결과는 하나지만 외부 작업 exactly-once는 보장하지 않음 |
| 이미지 | Item/Collection 소유권을 디코딩 앞으로 이동, 최종 저장에서도 다시 검사. Profile은 현재 로그인 사용자가 대상. 모든 업로드 HTTP 동시 1, queue 2를 모델 바인딩 전 획득해 디코딩/Blob 완료까지 유지. 기존 11MiB/6MiB HTTP, 10MiB/5MiB 파일, 32MP/8,000px 검증 유지 |
| 업로드 시간 | 이미지 3개 endpoint만 ASP.NET RequestTimeout 120초. queue/slow multipart 읽기도 취소 대상. 다른 API/Export streaming에는 이 timeout을 적용하지 않음. 네이티브 Skia 동기 호출을 강제 중단하지는 못하며 크기·동시성으로 별도 제한 |
| 비밀번호 | HTTP authenticated password 작업 동시 2, 실제 hasher도 static 동시 2(대기 0), 익명 포함. 공유 설정 5/15분 |
| SQL 원자적 시도 예약 | Collection row의 `UPDLOCK, ROWLOCK, NOWAIT`를 짧은 transaction 안에서 먼저 획득 → 모든 throttle bucket 검사 → 검증 → 실패 모두 기록 또는 성공 reset → commit. owner current-password 변경/최근 재인증 reset은 User row로 같은 예약. 경쟁 요청은 hash 전 429. 트랜잭션 동안 외부 HTTP 없음. 실패 결과를 commit한 다음 오류 반환 |
| 예약 한계 | 같은 Collection의 다른 정상 사용자가 동시에 unlock해도 잠깐 429 가능(2초 후 수동 재시도). DB connection을 해싱 동안 보유하므로 CPU·SQL 관측 필요. SQL NOWAIT가 대기열 누적을 막음 |
| Google RTDN | 기존 OIDC 인증 우선 유지. `RequestSizeLimit(64KiB)`, Content-Length 선검사, chunked도 최대 64KiB+1까지만 읽고 413. 전체 body를 메모리에 복사한 뒤 검사하던 동작 제거 |

HTTP admission은 `UseAuthentication → UseRequestTimeouts → UseRateLimiter → UserActivity → UseAuthorization → MVC` 순서다. admission에서 거부한 요청은 analytics pump, active-admin DB 및 MVC service에 들어가지 않는다. 서비스 내부의 outbound/SQL 예약 추가 거부는 이미 수행한 권한·소유권 읽기까지 없앴다는 뜻이 아니다. 해당 비싼 외부 HTTP/Blob/해싱을 시작하지 않는 것이 보장 범위다.

새 middleware/자원 포화 429는 `application/problem+json`, `code=rateLimited`, 고정 `policy=request-admission`, `Cache-Control: no-store`. Fixed-window Retry-After를 사용하고 동시성/예약 포화는 2초를 안내한다. 기존 SQL password 429의 코드와 Retry-After는 유지한다. CORS에 Retry-After 노출을 추가했다.

`Juple.RequestProtection` Meter의 `juple.request.rejected` counter를 제공한다. tag는 고정 policy 하나이며 URL/계정/IP/헤더/토큰은 넣지 않는다. **Azure 수집기·경고를 배포한 것은 아니다.** 기존 SQL password 실패 지표는 이 새 counter에 합산하지 않는다.

## 4. Android / iOS / Web / Admin 재시도

- 공통 오류 타입에 `retryAfterSeconds` 추가. delta-seconds/HTTP-date 지원, 없거나 잘못됐으면 2초, 최소 1초/최대 1일.
- 클라이언트별 최대 64개 method/경로 cooldown. query/body는 보관하지 않고 숫자 ID는 경로 template으로 축약한다. 클라이언트가 읽은 tid/oid는 cooldown 식별용이며 인증·인가에는 쓰지 않는다. 같은 계정의 token refresh에도 대기시간을 유지하고, 다른 계정은 clear하며 이전 계정의 늦은 응답은 무시한다. 서버 quota의 대체가 아니다.
- 429 자동 HTTP 재시도 **0회**, token refresh **0회**. 같은 경로 반복 호출은 cooldown 동안 네트워크로 보내지 않는다. 기존 GET transport retry 1회와 401 fresh retry 1회만 유지.
- 공유 Mobile client는 상태 격리용 factory도 제공한다. 독립 테스트/클라이언트가 이전 429를 이어받지 않게 한다.
- Android FCM 후속 재시도는 기존 15/60/180초 최대 3회이며 Retry-After가 더 길면 그 이상 기다린다. iOS FCM 미호출/APNs 기존 상태 유지.
- Mobile 공통 load와 링크 저장에 기존 17개 언어의 `collaboration.tooManyRequests` 사용. Web 링크 저장은 기존 dictionary 사용.
- 공개 Web items proxy는 API 429/Retry-After를 전달. ItemList는 이미 읽은 항목/cursor를 유지하고 수동 버튼을 cooldown 동안 막으며 자동 재시도하지 않는다. 잠금 폼도 대기시간과 기존 번역 문구를 사용. SSR 429는 기존 unavailable 상태로 표시하며 자동 API 재시도하지 않는다.

## 5. 다중 Replica / SQL 일일 예산 검토

- API 최대 3 Replica이면 계정 180/분은 최악 540/분, 읽기 120/분은 360/분, Inbox 30/분은 90/분까지 분산될 수 있다. window 경계 burst도 가능하다. 정확한 일일/과금 quota가 아니다.
- HTTP metadata 동시 4/Replica, 실제 outbound 동시 4/Replica → 서비스 최대 실제 outbound 12. 이미지 동시 1/Replica → 최대 3. hasher 2/Replica → 최대 6.
- 세션별 메모리 cache/cooldown/semaphore는 공유되지 않는다. Inbox unique ledger, 기존 Export user-row quota, 이번 SQL password 예약은 DB에서 공유된다.
- **일반 링크·사진의 SQL 일일 예산은 이번에 추가하지 않았다.** 제품의 하루 허용량/실패 환불 정책이 확정되지 않았고 분당 admission과 다른 계약이다.
- 후속 설계: `(UserId, UTC day, OperationKind)` unique usage/reservation; 특정 생성/업로드 시작에서만 user-row/update lock을 잡아 원자적으로 reserve, 완료/실패의 consume/refund를 request ID로 멱등 처리. Blob/HTTP 동안 transaction을 열어 두지 않고 짧은 lease/복구 정책 필요. 읽기나 모든 HTTP마다 SQL counter를 쓰지 않는다.
- 기존 Export 일일 quota의 동시 요청 테스트를 실행한다. 이는 링크/사진에 일일 quota를 새로 적용했다는 뜻이 아니다.
- Redis/유료 Azure 리소스는 추가하지 않았다. 추가 고정 Azure 비용은 0. admission/SQL 예약 자체의 CPU/DB 비용과 배포 후 실제 트래픽 비용은 별개다.

## 6. 검증 기록

테스트는 로컬/Mock이며 PROD 대상으로 실행하지 않았다.

| 최종 검증 | 결과 |
|---|---|
| Backend API build | PASS, 신규 package/Migration 없음 |
| Backend 전체 Unit | 2,181 PASS, skip 0 |
| 관련 SQL/Azurite Integration | 최종 소스 109 PASS, skip 0, 약 80초. localhost SQL/Azurite, pending migrations 0 |
| Mobile 전체 Jest | 205 suites / 3,044 tests PASS, skip 0, 약 276초 |
| Mobile typecheck / 변경 파일 lint | PASS |
| Web 전체 tests / typecheck / lint / production build | 849 tests PASS / 모두 PASS |
| Admin 전체 tests / typecheck / 변경 파일 lint | 51 tests PASS / 모두 PASS |
| git diff --check | PASS |
| Android/iOS Native 빌드·실기기 E2E | 미실행. Native 소스/버전/스토어 설정 변경 없음 |

Jest timeout을 늘리지 않았으며 새 rate-limit/auth 클라이언트 테스트는 기본 제한에서 통과했다. 기존 Backend 테스트의 nullable/analyzer warning과 기존 React renderer 진단 출력은 남아 있다.

- Backend: 전체 Unit, 서버 configuration override, 실제 운영 endpoint 정책 등록을 공유하는 Billing/Export/lock/public unlock 중첩 및 OFF 회귀, Export/증빙 streaming 동시 4와 거부 후 복구, 실제 MVC route 분류, 429/Retry-After, 다중 플랫폼 동일 키, 잘못된/미인증 claims, XFF/IPv6, 정상 166회 scenario, 이미지 bounded queue/취소/timeout, metadata refusal-before-HTTP, Inbox replay/동시성, 소유권-before-decode, RTDN bounded body.
- Integration: 기존 `infra/local/Test-Retention.ps1`의 localhost:14333/JupleRetTests 및 Azurite만 사용. migration runner가 원격을 거부한다. pending migration 0 확인. Collection lock/public share/password, Inbox SQL 멱등성, Export quota/consume/privacy/streaming, 이미지/Push 관련 109건을 실행했다.
- SQL 예약은 별도 context(Replica 역할)의 동시 시도가 실제 hash 전에 거부됨을 검증하고, 실패 5회 commit 후 다른 connection에서도 hash 전에 거부됨을 검증한다.
- Web 전체 테스트 및 typecheck/lint/build, Mobile 전체 Jest 및 typecheck/변경 파일 lint, Admin 회귀 및 typecheck/변경 파일 lint.
- 첫 Mobile 전체 실행: 3037/3039. 새 cooldown의 테스트 간 상태 누출 1건을 factory로 격리했다. 기준 HEAD에서 이미 Android build=32인데 테스트가 정확히 31을 요구하던 불일치 1건은 출시된 30보다 높다는 원래 목적의 조건으로 수정했다. **앱 build/version을 변경하거나 테스트를 skip/timeout 상향하지 않았다.**
- Commit 전 범위: tracked 수정 52개 + 신규 15개(이 문서 포함), 총 67개. 기존 untracked 보호 로그는 별도 보존. `unit-test-diag.log` SHA-256은 시작/종료 동일: `A9FEFCC27B8D2C861F950526FFACFAA801D13D6C75311F82C45ADC6220135CFE`. 다른 보호 파일 `logcat-r35a-final-polish-samsung.txt`는 시작 시 없었으며 생성하지 않았다.
- Git fetch 후 `origin/master`는 시작 기준 `e9f7e10b811d74afb2483d505e2cbbbcc1178327`과 동일했다. 승인된 메시지는 `feat(security): add API rate limiting and abuse protection`. 정상 fast-forward Push만 허용하며 실제 완료 hash는 Git 이력과 최종 보고에서 확인한다.

### 최종 추가 검토와 실제 사용 패턴 Mock

| 요청한 사용 패턴 | 로컬 검증 / 보장 범위 |
|---|---|
| 최초 로그인·Home | Bootstrap/세션/약관/목록/count/unread의 admission 및 전체 Mobile 인증/화면 회귀 |
| 링크 10개 연속 | 정상 166-call 시나리오, 서비스의 서로 다른 10개 저장 및 동일 request ID replay/conflict. destination 권한은 replay보다 먼저 검사하고 SQL ledger unique 유지 |
| 이미지 5개 연속 | 5개 순차 admission 모두 성공(166-call에서는 10개). 기존 ItemDetails는 picker 1개와 beginPhotoChange 가드로 동시 중복 업로드를 막음 |
| 빠른 History·상세·검색·댓글·친구·알림 | 정상 시나리오 및 Android/iOS/Web 3개 호출 계획을 같은 tid/oid로 병렬 실행. 합산 105회 + 이미지 5회, 조회 96회. 모두 허용 |
| 같은 계정의 3개 플랫폼 | 서버 budget은 플랫폼과 무관하게 공유하며, 낮춘 예산에서 세 번째 플랫폼의 거부도 확인. 정상 시나리오 통과는 무제한 사용 보증이 아님 |
| 공개 방문자 집중 | 같은 socket peer의 공개 GET 400회가 기본 OFF 정책에서 허용됨. 명시적으로 켠 IP 제한에서는 XFF 회전이 새 bucket을 만들지 못함 |
| 관리자 동시 조회 | 같은 관리자 20개 병렬 admission 허용, Admin client 10개 병렬 Mock 응답 성공 |
| 429 복구 | Mobile/Web/Admin clock 제어로 Retry-After 후 수동 요청 성공. 서버 image cancel/timeout/queue 및 기존 Export·증빙 stream lease 반환 후 다음 요청 성공 |
| 취소·세션 전환 | 활성/대기 업로드 취소, Mobile timeout 시 AbortSignal 전달·쓰기 재전송 없음, 429가 token refresh를 만들지 않음, push DELETE cleanup과 다른 계정 로그인 허용 |

최종 리뷰에서 수정한 항목은 새 익명 IP 제한의 기본 비활성화다. 기존 named policy 등록은 `RateLimitPolicies.ConfigureEndpointPolicies`로 이동해 Program과 테스트가 같은 실제 등록 코드를 사용하게 했다(기존 제한값 변경 없음). 정상 180/120 기본값은 위 계산에서 여유가 있으나, 빠른 대량 스크롤·여러 탭·기기 합산이 한도를 넘으면 429가 올 수 있다. 배포 후 거부율을 관찰하고 서버 설정으로 조정한다.

### Android v32 / 현재 PROD revision 호환성

- 읽기 전용 `az containerapp show`, `revision show`, ACR manifest metadata에서 활성/최신 revision `ca-juple-api-prod--0000029`, traffic 100%, image digest `sha256:e93e972b9f8cd84736dd09e6ffab3b31e945d26c0d8c76e1a6d7d339773040ba`, tag `api-131984a-prod-20261020`을 확인했다.
- PROD Android 정책은 latest 31 / minimum 24, 로컬 Android versionCode는 32 / versionName 1.0이다. v32는 강제 업데이트 대상이 아니다. 실제 Play 업로드/가격/설정은 조회·변경하지 않았다.
- v32 기준 `3cfac62`부터 시작 HEAD까지 Mobile 기능 소스 변경이 없다. 배포 API `131984a`와 비교하면 관련 Bootstrap은 retention/export가 없는 구형 응답이며 Mobile은 해당 필드 부재를 null/false로 처리한다. 기존 bootstrap 호환성 테스트와 전체 Mobile 회귀에서 검증한다.
- Android FCM 요청은 기존 platform/installationId/pushToken/locale JSON을 유지한다. 배포 API와 현재 서버 모두 이 형식을 처리하며 새 APNs 환경 필드는 선택적이다. 이번 라운드는 push request/response DTO나 API route를 바꾸지 않는다. APNs Backend 단위 테스트는 전체 Backend에 포함된다. iOS Native APNs 등록은 기존 `apnsNotReady` 상태로 출시 QA가 남아 있다.
- 기존 v32도 HTTP 429를 `tooManyRequests`로 분류하며 401만 인증 갱신한다. 기존 앱은 이번 새 Retry-After cooldown UI가 없다는 한계가 있다. 새 서버에서도 요청/성공 응답 계약은 유지된다.
- Billing ProgramEnabled는 base config false, Export는 옵션 기본 false, RET 정책 시점 미설정/Billing OFF의 회귀를 유지한다. 활성 PROD revision에는 조회한 Billing/Export/새 RequestProtection override가 없으며 이번에 추가하지 않았다. RET 자동 삭제/새 Job/Migration/PROD 설정 변경도 없다.
- 이는 코드·설정·Mock 호환성 검토다. Android v32 실제 로그인/Home/FCM/이미지/잠금/계정 삭제·재인증·429 UX는 DEV 또는 승인된 QA 환경의 실기기에서 추가 확인해야 한다. PROD API를 호출하거나 실기기 E2E를 실행한 결과가 아니다.

## 7. 정상 사용자 위험 및 다음 라운드

1. **IP 신뢰 경계 확인**: 새 익명 IP 제한은 기본 OFF다. 안전한 ingress 관측으로 peer/신뢰 proxy 정책을 검증한 후 별도 승인으로 활성화해야 한다. 임의 XFF 신뢰로 해결하지 않는다. 공개 조회의 대량 요청 방어와 인증 전 CPU/대역폭 보호는 미완료다.
2. 큰 shortcut 복원 순회, 여러 기기/탭 동시 사용, 극단적인 검색/scroll은 분당 예산에 도달할 수 있다. 배포 전 기기 QA와 배포 후 익명화된 거부량/응답시간을 관찰하며 조정한다. PROD 부하/실계정 E2E는 하지 않았다.
3. 업로드는 Replica별 1개 + 대기 2개라 정상 병렬 요청도 429/120초 timeout을 만날 수 있다. 실제 최대 이미지의 메모리·CPU와 저속 네트워크 QA 후 동시성 조정. 활성화된 API Replica 감소로 공격을 방어하지 않는다.
4. 일반 URL in-flight 합병과 Inbox cross-replica metadata exactly-once는 후속. 현재 비용은 semaphore로 상한을 둔다.
5. 링크/사진의 제품 일일 quota/저장 예산을 결정한 후 SQL 원자적 reservation 별도 구현.
6. 프로세스 간 정확한 rate quota, 많은 IP/계정, JWT 검증 전 CPU, 이미 Ingress에 들어온 요청/대역폭 비용은 이 앱 제한만으로 막지 못한다. 실제 DDoS 방어나 SQL S0 수용량 보증이 아니다.
7. 429/요청 급증/p95/SQL DTU·connections/Blob/Service Bus backlog·예산 경고와 Meter exporter는 별도 운영 단계. Front Door/WAF/분산 limiter는 트래픽·예산에 따라 별도 승인. 예산 알림은 자동 비용 차단 장치가 아니다.
8. iOS Native/APNs/다운로드 실기기 출시 QA 등 기존 backlog는 유지한다. 이번에는 공통 HTTP client의 Mock 호환성을 확인하며 Native 빌드나 실제 Store/Billing 설정을 바꾸지 않는다.

## 핵심 소스

- [Admission/설정](../backend/src/Juple.Api/Configuration/RequestProtection.cs), [middleware 순서](../backend/src/Juple.Api/Program.cs)
- [SQL 시도 예약](../backend/src/Juple.Infrastructure/Collections/CollectionPasswordAttempt.cs), [password verifier](../backend/src/Juple.Application/Collections/Locking/CollectionPasswordVerifier.cs)
- [Inbox gate](../backend/src/Juple.Application/Inbox/SaveInboxEntry/InboxRequestGate.cs), [metadata gate](../backend/src/Juple.Infrastructure/UrlMetadata/MetadataWorkGate.cs)
- [Mobile client](../apps/mobile/src/api/apiClient.ts), [Web client](../apps/web/lib/appApi.ts), [Admin client](../apps/admin/lib/adminApi.ts)
- [HTTP 보호 테스트](../backend/tests/Juple.UnitTests/Configuration/RequestProtectionTests.cs)

## 변경 파일 목록 (보호 로그 제외)

Commit 직전 tracked 수정 52개, 신규 15개. 아래 67개 경로가 승인된 Git 반영 범위이며 보호 로그는 제외한다.

```text
 M apps/admin/lib/adminApi.ts
 M apps/mobile/src/api/ApiError.ts
 M apps/mobile/src/api/__tests__/apiClientHeadersAndCodes.test.ts
 M apps/mobile/src/api/apiClient.ts
 M apps/mobile/src/components/LoadFailureState.tsx
 M apps/mobile/src/components/__tests__/LoadFailureState.test.tsx
 M apps/mobile/src/navigation/__tests__/openAppLink.test.ts
 M apps/mobile/src/push/__tests__/usePushRegistrationSync.test.tsx
 M apps/mobile/src/push/pushRegistrationStatus.ts
 M apps/mobile/src/push/pushRegistrationSync.ts
 M apps/mobile/src/push/usePushRegistrationSync.ts
 M apps/mobile/src/screens/NewLinkReviewScreen.tsx
 M apps/web/app/c/[publicId]/ItemList.tsx
 M apps/web/app/c/[publicId]/LockedGate.tsx
 M apps/web/app/c/[publicId]/actions.ts
 M apps/web/app/c/[publicId]/items/route.ts
 M apps/web/lib/appApi.ts
 M apps/web/lib/newLink.ts
 M apps/web/lib/publicApi.ts
 M backend/src/Juple.Api/Collections/CollectionLockPasswordHasher.cs
 M backend/src/Juple.Api/Configuration/AuthenticatedWebCors.cs
 M backend/src/Juple.Api/Configuration/RateLimitPolicies.cs
 M backend/src/Juple.Api/Controllers/CollectionsController.cs
 M backend/src/Juple.Api/Controllers/GoogleRtdnController.cs
 M backend/src/Juple.Api/Controllers/ItemImagesController.cs
 M backend/src/Juple.Api/Controllers/UserProfileController.cs
 M backend/src/Juple.Api/Program.cs
 M backend/src/Juple.Api/appsettings.json
 M backend/src/Juple.Application/Collections/ICollectionStore.cs
 M backend/src/Juple.Application/Collections/Locking/CollectionLockSettings.cs
 M backend/src/Juple.Application/Collections/Locking/CollectionPasswordVerifier.cs
 M backend/src/Juple.Application/Collections/Locking/ICollectionLockStore.cs
 M backend/src/Juple.Application/Collections/SetCollectionIconImage/SetCollectionIconImageService.cs
 M backend/src/Juple.Application/Images/IItemImageStore.cs
 M backend/src/Juple.Application/Images/UploadItemImage/UploadItemImageService.cs
 M backend/src/Juple.Application/Inbox/IInboxEntryStore.cs
 M backend/src/Juple.Application/Inbox/SaveInboxEntry/InboxEntrySaveService.cs
 M backend/src/Juple.Infrastructure/Collections/CollectionLockSettingsStore.cs
 M backend/src/Juple.Infrastructure/Collections/CollectionLockStore.cs
 M backend/src/Juple.Infrastructure/Collections/CollectionStore.cs
 M backend/src/Juple.Infrastructure/DependencyInjection.cs
 M backend/src/Juple.Infrastructure/Images/ItemImageStore.cs
 M backend/src/Juple.Infrastructure/Items/ItemStore.cs
 M backend/src/Juple.Infrastructure/UrlMetadata/UrlMetadataResolver.cs
 M backend/tests/Juple.IntegrationTests/Collections/CollectionLockPasswordAndRoleIntegrationTests.cs
 M backend/tests/Juple.UnitTests/Billing/GooglePlay/GoogleBillingProcessorTests.cs
 M backend/tests/Juple.UnitTests/Collections/CollectionAccessTestDoubles.cs
 M backend/tests/Juple.UnitTests/Collections/SetCollectionIconImageServiceTests.cs
 M backend/tests/Juple.UnitTests/Images/DeleteItemImageServiceTests.cs
 M backend/tests/Juple.UnitTests/Images/UploadItemImageServiceTests.cs
 M backend/tests/Juple.UnitTests/Inbox/CollectionShareUrlGuardTests.cs
 M backend/tests/Juple.UnitTests/Inbox/DailyInboxServicesTests.cs
?? apps/admin/lib/retryAfter.ts
?? apps/admin/tests/rateLimit.test.ts
?? apps/mobile/src/api/__tests__/rateLimit.test.ts
?? apps/mobile/src/api/retryAfter.ts
?? apps/web/lib/retryAfter.ts
?? apps/web/tests/rateLimit.test.ts
?? backend/src/Juple.Api/Configuration/RequestCapacityExceptionFilter.cs
?? backend/src/Juple.Api/Configuration/RequestProtection.cs
?? backend/src/Juple.Application/Collections/Locking/ICollectionPasswordAttempt.cs
?? backend/src/Juple.Application/Inbox/SaveInboxEntry/InboxRequestGate.cs
?? backend/src/Juple.Application/RequestCapacityExceededException.cs
?? backend/src/Juple.Infrastructure/Collections/CollectionPasswordAttempt.cs
?? backend/src/Juple.Infrastructure/UrlMetadata/MetadataWorkGate.cs
?? backend/tests/Juple.UnitTests/Configuration/RequestProtectionTests.cs
?? docs/api-request-protection.md
```
