# 정식 체험 재가입 동시성 수정 — 로컬 검증 / 운영 적용 대기

## 원인과 수정

이전 구현은 User/ExternalIdentity 생성만 commit한 뒤 디렉터리 이메일 조회와 기간 승계를 실행했다.
그 사이 두 번째 bootstrap이 이미 생성된 계정을 발견하면 승계 없이 새 정식 체험을 확정했다.
뒤늦은 승계는 사용자 필드의 null 조건에 막혔다. 이전 SQL 재현의 기대 assertion 2개 실패
증거는 보존했다. 운영 데이터에 같은 상태가 있었다고 단정하지 않는다.

현재 순서:

1. 기존 계정이면 기존 경로 유지. 신규 생성은 기존 최근 인증·삭제 대기 검사를 먼저 통과한다.
2. 신뢰된 Entra 디렉터리의 이메일을 조회하고 기존 정규화/HMAC 정책으로 해시한다.
   이 단계에서는 계정을 만들거나 SQL 트랜잭션/잠금을 보유하지 않는다.
3. SQL 생성 트랜잭션에서 이메일 HMAC별 transaction-owned `sp_getapplock`을 획득한다.
   기존 Push 등록과 같은 패턴이며 다른 프로세스/서버에서도 공유된다. 대기는 15초로 제한한다.
4. User와 ExternalIdentity를 생성하고 같은 트랜잭션에서 과거/정식 기간을 승계한다.
5. 프로그램이 활성화된 구성에서는 기존 이메일/외부 식별자 공식 Ledger 기간을 우선한다.
   둘 다 없을 때만 max(가입 시각, 프로그램 시작 시각) + 720시간을 후보로 사용한다.
   이메일/외부 식별자 해시의 alias와 사용자 공식 필드를 같은 트랜잭션에서 기록하고 commit한다.
   기존 이메일/식별자의 두 기록이 서로 다르면 임의로 선택·덮어쓰기하지 않고 실패한다.
6. 동일 외부 식별자 경합은 기존 고유 제약/rollback 후 승자 재조회로 수렴한다.
   동일 이메일의 서로 다른 외부 식별자도 하나의 canonical 기간에 수렴한다.

`EntitlementStore.EnsureTrialAsync`도 사용자 `UPDLOCK,HOLDLOCK` 이후 현재 공식 필드를 재조회한다.
이미 승계된 기간이면 호출자가 가져온 낡은 신규 후보 대신 그 기간을 반환한다.
Ledger 생성과 사용자 projection은 하나의 트랜잭션이다.
계정 삭제는 이메일 잠금 → 사용자 행 잠금 순으로 최종 기간을 읽고 보존한다.
삭제가 먼저 끝나면 뒤의 체험 확정은 없는 계정으로 실패하여 고아 신규 지급을 만들지 않는다.

디렉터리 오류는 더 이상 무시하지 않는다. 프로그램 활성 구성에서 이메일을 확인하지 못하면
새 계정/체험을 생성하지 않고 명시적으로 실패한다. 비활성 구성에서는 새 정식 체험을 만들지 않는다.
기존 계정의 조회에는 새 디렉터리 의존성을 넣지 않았다. 유료 구독/관리자 지급 평가·우선순위는 그대로다.
잠금 음수 결과, SQL deadlock/timeout, 취소, transaction 실패는 성공으로 바꾸지 않는다.
실패한 생성 트랜잭션은 rollback/dispose되고 새 요청으로 안전하게 재시도한다. 무한 자동 재시도는 없다.

## 보존 및 운영 영향

- 기존 TrialLedger, 공식 Ledger, 구매·관리자 지급 기록을 삭제/초기화/보정하지 않는다.
- 이메일 원문을 저장하지 않으며 case/trim 정규화, HMAC 도메인 및 키 정책은 변경하지 않는다.
- 공식 이메일 alias도 기존 종료 시각 기준 24개월 보존 정책을 그대로 따른다. 평생 식별 보유 보장은 아니다.
- 추가 migration/모델 변경 없음. 이전 `20261121082950_AddOfficialMembershipTrials`는 여전히 별도 운영 승인·적용 대상이다.
- PROD DB/설정/배포/결제에 접근하여 수정하지 않았다. ProgramEnabled=false 운영 방침 유지.
- 실제 PROD의 불완전 식별자, 과거 잘못 확정된 기간, 충돌 Ledger는 읽기 전용 감사가 필요하다.
  이번 코드는 그런 데이터를 자동 복구하지 않는다.

## 영구 SQL 회귀

`backend/tests/Juple.IntegrationTests/Billing/MembershipRejoinConcurrencyIntegrationTests.cs`:

- 디렉터리 조회가 지연된 첫 요청보다 두 번째 요청이 먼저 끝나는 순서: 두 응답 모두 기존 만료 기간.
- 계정/식별자 INSERT 이후, 이메일 공식 Ledger 조회 이전을 interceptor로 정지: 다른 bootstrap은 부분 계정으로 진행 불가.
- 생성 commit 전 오래된 신규 Entitlement 후보 요청: commit 이후 승계된 기존 기간 재사용.
- 동일 외부 식별자 8건 / 동일 이메일·다른 외부 식별자 8건 동시 재가입: 기존 만료 기간 유지.
- 기존 이메일 기록이 없는 동시 8건: 서로 다른 생성 시각에도 같은 canonical 720시간.
- commit 직전 오류 주입: 계정·새 alias rollback, 원래 기록 유지, 재시도 성공.
- 실제 SQL application lock timeout: 명시적 51001 실패, 계정 미생성, 잠금 해제 후 재시도 성공.
- 이메일 누락 / 디렉터리 오류: 계정·체험 미생성.
- 탈퇴/다른 ObjectId 재가입 3회 및 동일 요청 반복: 원래 만료 기간 유지.
- 체험 확정 commit과 계정 삭제 경합: 확정된 기간을 보존하고 다음 재가입에 승계.
- 다른 이메일의 기록은 사용하지 않음. 충돌하는 기존 공식 기록은 원문 보존 후 명시적 실패.
- 유효한 유료 구독 / 관리자 무료 멤버십: 만료된 체험 때문에 해당 권한을 잃지 않음.

TaskCompletionSource 및 SQL interceptor로 실행 순서를 통제한다. Delay나 순서 의존 assertion 완화는 없다.
테스트는 localhost:14333/JupleRetTests + Azurite만 허용하고 임의 해시 키/합성 이메일을 사용한다.
이 테스트의 cleanup은 자신이 만든 계정·alias·구매·cleanup task만 대상으로 한다.
기존 테스트 DB를 삭제/초기화하거나 운영 데이터를 복제하지 않았다.

## 검증 결과

SQL Server 17.0.4075.5, Docker juple-sql/juple-azurite healthy.

| 범위 | 결과 |
|---|---|
| 요청 범위 SQL 전체: 기존 74 + 신규 16 | 90 통과 / 0 실패 / 0 건너뜀 |
| 신규 경합 회귀 반복 | 16개 × 5회 = 80 통과 / 0 실패 / 0 건너뜀 |
| Backend 전체 단위 | 2,636 통과 / 0 실패 / 0 건너뜀 |
| EF Pending Model Changes | 없음 |
| Backend/SQL 테스트 빌드 | 통과, 기존 nullable/analyzer 경고 유지 |
| 실제 SQL deadlock victim 강제 주입 | 미실행; SQL 오류 전파·트랜잭션 rollback 구조 확인 |
| PROD 정합성 감사·운영 적용 | 미실행 |
| Mobile/Web·스토어·실결제 | 이번 Backend 동시성 수정에서는 미실행, 클라이언트/API 계약 변경 없음 |

TRX는 저장소 밖 로컬 임시 검증 디렉터리에 보존하며 비밀값이나 운영 개인정보를 보고서에 넣지 않는다.
테스트가 검증한 보존 기간 내 경합에 대해서는 새 기간 재지급이 없었다.
모든 가능한 운영 상태에 대한 절대 보증이나 PROD DB 정합성 확인으로 확대하지 않는다.

## 이번 수정 파일

- Application: CurrentUserBootstrapData, CurrentUserBootstrapService, ICurrentUserProvisioningStore
- Infrastructure: CurrentUserProvisioningStore, MembershipTrialSqlLock, EntitlementStore, AccountDeletionStore
- SQL tests: 신규 MembershipRejoinConcurrencyIntegrationTests, 기존 TrialFoundationIntegrationTests,
  MembershipIdentitySafetyIntegrationTests, EntraAccountDeletionIntegrationTests
- Unit tests: CurrentUserBootstrapServiceTests — 이메일 HMAC이 생성 트랜잭션에 전달되는 계약 검증
- 문서: 본 문서, membership-commit-review.md, membership-identity-safety.md

master/HEAD 및 origin/master는 `8e176c6e44a9f7d50ae75adbd71f9a3dadd4d0e6`로 변경 없음.
누적 작업 후보 84개(추적 수정 52, 신규 작업 32), 보호 미추적 3개 별도다. 이번 라운드는 그중 15개 파일을 수정/추가했다.
stage/Commit/Push 없음. 보호 미추적 3개 크기·SHA-256 동일. 이전 SQL 실패 증거도 보존했다.
