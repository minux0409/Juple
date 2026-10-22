'use client';
import Link from 'next/link';
import { useAdmin, useAdminQuery } from '../AdminRoot';
import { expenseBase, categories, type ExpenseConfig } from '../../../lib/expenses';
import { workspaceBase } from '../../../lib/workspace';

export default function SettingsPage() {
  const { me } = useAdmin();
  const expenses = useAdminQuery<ExpenseConfig>(`${expenseBase}/configuration`);
  const workspace = useAdminQuery<{ enabled: boolean; timeZone: string; maxDays: number }>(`${workspaceBase}/configuration`);
  return <><header className="page-header"><h1>Settings · 연동 및 관리 기준</h1></header>
    <div className="workspace-grid"><section className="card"><h2>관리자 권한</h2><p>현재 역할: {me.role}</p><p>모든 API는 매 요청마다 활성 Owner/Admin 권한을 검증합니다. 브라우저에서 권한을 변경하지 않습니다.</p></section>
      <section className="card"><h2>통계 설정</h2>{workspace.error ? <p role="alert">통계 API 미배포 또는 조회 실패: {workspace.error}</p> : <p>통계 {workspace.data?.enabled ? '활성' : '비활성'} · Asia/Seoul · 기본 7일 · 최대 366일</p>}<p>기존 UTC 분석은 별도 메뉴에서 유지합니다.</p></section>
      <section className="card"><h2>증빙 및 원장</h2>{expenses.error ? <p role="alert">{expenses.error}</p> : <><p>원장: {expenses.data?.enabled ? '활성' : '비활성'}</p><p>증빙 검사: {expenses.data?.evidenceScanningConfigured ? '설정 존재 — 실제 업로드 검사 시 검증' : '미설정 — 업로드 거부'}</p></>}<p>10 MiB 제한 · 비공개 저장 · 인증된 다운로드 · 변경 이력 보존</p></section>
      <section className="card"><h2>Azure Cost Management</h2><p>자동 수집: {expenses.data?.azureSyncEnabled ? '설정 ON — 실행 결과에서 권한 검증' : 'OFF'}</p><p>최소 Cost Management Reader를 선택한 리소스 그룹 범위에 부여해야 합니다. 앱 서버 Managed Identity의 실제 권한은 동기화 성공 전까지 미검증입니다.</p>{expenses.data?.azureScopes.length ? <ul>{expenses.data.azureScopes.map(x => <li key={x.scope}><code>{x.scope}</code> · {x.environment}{x.allowWholeSubscription ? ' · 전체 구독(다른 프로젝트 포함 가능)' : ' · 지정 리소스 그룹'}</li>)}</ul> : <p>Juple 전용 비용 범위가 지정되지 않았습니다.</p>}<p>최종 카드 청구액과 다를 수 있으며 세금·크레딧·할인·데이터 반영 지연은 청구서로 확인합니다. 환율을 자동 추정하지 않습니다.</p><Link href="/expenses">비용·동기화 이력 열기</Link></section>
      <section className="card"><h2>비용 분류</h2><ul>{Object.values(categories).map(label => <li key={label}>{label}</li>)}</ul><p>사용자 정의 분류는 기타 비용의 분류명을 입력합니다. 발생일 기준 집계이며 귀속 기간을 일할 상각하지 않습니다.</p></section>
      <section className="card"><h2>외부 결제 내역</h2><p>Apple Developer 연회비, Google Play 등록비, 도메인, AI/도구 구독은 영수증과 수동 원장·반복 일정으로 관리합니다. 해당 비용의 공식 청구 API와 권한이 확인되지 않은 연동은 자동화하지 않습니다.</p><p>Apple/Google의 앱 매출 보고서는 개발자 등록비 영수증 API와 별개입니다. 결제 페이지 스크래핑이나 계정 로그인 우회는 하지 않습니다.</p></section>
    </div>
  </>;
}
