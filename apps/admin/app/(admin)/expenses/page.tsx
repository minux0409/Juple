'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { failureMessage } from '../../../lib/adminModel';
import { ApiHttpError } from '../../../lib/adminApi';
import {
  blankExpense,
  categories,
  downloadBlob,
  expenseBase,
  expenseQuery,
  initialFilters,
  money,
  statuses,
  validateExpense,
  type Audit,
  type ExpenseConfig,
  type ExpensePage,
  type ExpenseRow,
  type ExpenseValues,
  type Schedule,
  type Summary,
  type SyncRun,
} from '../../../lib/expenses';
import { PageState, useAdmin } from '../AdminRoot';

export default function ExpensesPage() {
  const { api, reportFailure } = useAdmin();
  const [today] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [config, setConfig] = useState<ExpenseConfig | null>(null);
  const [filters, setFilters] = useState(() => initialFilters(today));
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState<ExpensePage | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [dueCosts, setDueCosts] = useState<ExpenseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<ExpenseRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [auditMore, setAuditMore] = useState(false);
  const [auditLookup, setAuditLookup] = useState('');
  const [auditTarget, setAuditTarget] = useState<number | null>(null);
  const [scope, setScope] = useState('');
  const [month, setMonth] = useState(today.slice(0, 7));
  const reload = useCallback(() => setRevision(r => r + 1), []);
  useEffect(() => {
    let current = true;
    const query = expenseQuery(applied);
    api<ExpenseConfig>({ path: `${expenseBase}/configuration` })
      .then(async result => {
        if (!current) return;
        setConfig(result);
        setScope(previous => previous || result.azureScopes[0]?.scope || '');
        if (!result.enabled) {
          setLoading(false);
          setError(null);
          return;
        }
        const [nextPage, nextSummary, nextSchedules, nextRuns, nextDueCosts] =
          await Promise.all([
            api<ExpensePage>({ path: `${expenseBase}?${query}` }),
            api<Summary>({ path: `${expenseBase}/summary?${query}` }),
            api<Schedule[]>({ path: `${expenseBase}/schedules` }),
            api<SyncRun[]>({ path: `${expenseBase}/sync` }),
            api<ExpenseRow[]>({ path: `${expenseBase}/due?asOf=${today}` }),
          ]);
        if (current) {
          setPage(nextPage);
          setSummary(nextSummary);
          setSchedules(nextSchedules);
          setRuns(nextRuns);
          setDueCosts(nextDueCosts);
          setError(null);
        }
      })
      .catch(e => {
        reportFailure(e);
        if (current) setError(failureMessage(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, applied, revision, reportFailure, today]);
  const action = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      reportFailure(e);
      setError(
        e instanceof ApiHttpError && e.status === 409
          ? '중복 기록이 있거나 다른 작업에서 변경되었습니다. 목록을 새로고침하고 확인하세요.'
          : failureMessage(e),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const exportFile = (format: 'csv' | 'xlsx') =>
    action(async () => {
      const blob = await api<Blob>({
        path: `${expenseBase}/export?${expenseQuery(applied)}&format=${format}`,
        responseType: 'blob',
      });
      downloadBlob(
        blob,
        `juple-expenses-${applied.from}-${applied.through}.${format}`,
      );
    });
  const open = (row: ExpenseRow) => {
    setSelected(row);
    setEditing(false);
    setAudits([]);
  };
  const refreshSelection = async (id: number) => {
    const row = await api<ExpenseRow>({ path: `${expenseBase}/${id}` });
    setSelected(row);
    reload();
  };
  return (
    <>
      <header className="page-header">
        <h1>사업비용</h1>
        <button disabled={busy} onClick={reload}>
          새로고침
        </button>
      </header>
      <PageState error={error} loading={loading && !page} onRetry={reload} />
      {config && !config.enabled ? (
        <p className="state">
          사업비용 기능이 비활성화되어 있습니다. 로컬 Migration·권한·증빙 검사
          설정 검증 후 별도 승인으로 활성화합니다.
        </p>
      ) : null}
      {config?.enabled ? (
        <>
          <p className="muted">
            통화와 결제 상태를 분리하여 집계합니다. Azure 사용량은 세금·크레딧이
            확정된 청구서가 아니며, 청구서 대사 전에는 추정액입니다. 집계는 세무
            정리 보조 자료이며 비용 인정·매입세액 공제를 확정하지 않습니다.
          </p>
          <form
            className="expense-filters"
            onSubmit={event => {
              event.preventDefault();
              setLoading(true);
              setApplied({ ...filters });
            }}
          >
            <label>
              시작일
              <input
                type="date"
                required
                value={filters.from}
                onChange={e => setFilters({ ...filters, from: e.target.value })}
              />
            </label>
            <label>
              종료일
              <input
                type="date"
                required
                value={filters.through}
                onChange={e =>
                  setFilters({ ...filters, through: e.target.value })
                }
              />
            </label>
            <label>
              카테고리
              <select
                value={filters.category}
                onChange={e =>
                  setFilters({ ...filters, category: e.target.value })
                }
              >
                <option value="">전체</option>
                {Object.entries(categories).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              결제 상태
              <select
                value={filters.status}
                onChange={e =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                <option value="">전체</option>
                {Object.entries(statuses).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                'currency',
                'provider',
                'paymentMethod',
                'environment',
                'serviceName',
              ] as const
            ).map(key => (
              <label key={key}>
                {
                  {
                    currency: '통화',
                    provider: '공급자',
                    paymentMethod: '결제 수단',
                    environment: '환경',
                    serviceName: 'Azure 서비스',
                  }[key]
                }
                <input
                  maxLength={key === 'currency' ? 3 : 200}
                  value={filters[key]}
                  onChange={e =>
                    setFilters({
                      ...filters,
                      [key]:
                        key === 'currency'
                          ? e.target.value.toUpperCase()
                          : e.target.value,
                    })
                  }
                />
              </label>
            ))}
            <button disabled={busy} type="submit">
              조회
            </button>
            <button
              type="button"
              onClick={() => {
                const year = initialFilters(today);
                setFilters(year);
                setApplied(year);
              }}
            >
              올해
            </button>
            <button
              type="button"
              onClick={() => {
                const first = `${today.slice(0, 7)}-01`;
                const last = new Date(
                  Number(today.slice(0, 4)),
                  Number(today.slice(5, 7)),
                  0,
                ).toLocaleDateString('sv-SE');
                const next = { ...filters, from: first, through: last };
                setFilters(next);
                setApplied(next);
              }}
            >
              이번 달
            </button>
          </form>
          <section className="cards" aria-label="기간별 지출 합계">
            {summary?.totals.map(total => (
              <article
                className="card"
                key={`${total.currency}-${total.status}`}
              >
                <div className="card-label">
                  {total.currency} · {statuses[total.status]}
                </div>
                <div className="card-value">
                  {money(total.gross, total.currency)}
                </div>
                <p>
                  공급가 {money(total.net, total.currency)} · 세액{' '}
                  {money(total.tax, total.currency)}
                </p>
                <p className="muted">
                  {total.rows}건 · 증빙 없음 {total.missingEvidence}건 · 세액
                  미확인 {total.unknownTax}건
                </p>
              </article>
            ))}
          </section>
          {summary?.totals.length === 0 ? (
            <p>조회 기간의 비용이 없습니다.</p>
          ) : null}
          {summary ? <ExpenseBreakdowns summary={summary} /> : null}
          <header className="page-header">
            <h2>비용 목록</h2>
            <div className="tabs">
              <button
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setAudits([]);
                  setEditing(true);
                }}
              >
                신규 비용
              </button>
              <button disabled={busy} onClick={() => void exportFile('csv')}>
                CSV
              </button>
              <button disabled={busy} onClick={() => void exportFile('xlsx')}>
                Excel
              </button>
            </div>
          </header>
          <div className="expense-table">
            <table>
              <thead>
                <tr>
                  <th>발생일 / ID</th>
                  <th>비용 / 공급자</th>
                  <th>원금 / 세액</th>
                  <th>상태 / 출처</th>
                  <th>증빙</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {page?.items.map(row => (
                  <tr key={row.expense.id}>
                    <td>
                      {row.expense.occurredOn}
                      <br />#{row.expense.id}
                    </td>
                    <td>
                      {row.expense.name}
                      <br />
                      <span className="muted">
                        {row.expense.provider} ·{' '}
                        {categories[row.expense.category]}
                      </span>
                    </td>
                    <td>
                      {money(row.expense.grossAmount, row.expense.currency)}
                      <br />
                      <span className="muted">
                        세액{' '}
                        {money(row.expense.taxAmount, row.expense.currency)}
                      </span>
                    </td>
                    <td>
                      {statuses[row.expense.status]} / {row.expense.source}
                      {row.expense.reconciledByExpenseId ? (
                        <p>
                          청구서 #{row.expense.reconciledByExpenseId} 대사 완료
                          · 집계 제외
                        </p>
                      ) : null}
                      {row.expense.noLongerReported ? (
                        <p>최신 Azure 응답에서 제외 · 집계 제외</p>
                      ) : null}
                    </td>
                    <td>{row.attachments.length || '없음'}</td>
                    <td>
                      <button onClick={() => open(row)}>열기</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page?.nextCursor ? (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const next = await api<ExpensePage>({
                    path: `${expenseBase}?${expenseQuery(
                      applied,
                      page.nextCursor,
                    )}`,
                  });
                  setPage({
                    items: [...page.items, ...next.items],
                    nextCursor: next.nextCursor,
                  });
                })
              }
            >
              더 보기
            </button>
          ) : null}
          {editing ? (
            <ExpenseEditor
              key={`${selected?.expense.id ?? 'new'}-${
                selected?.expense.revision ?? revision
              }`}
              row={selected}
              today={today}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={(
                values,
                requestId,
                frequency,
                nextDueOn,
                reconcilesExpenseIds,
              ) =>
                action(async () => {
                  const saved = await api<ExpenseRow>({
                    path: selected
                      ? `${expenseBase}/${selected.expense.id}`
                      : expenseBase,
                    method: selected ? 'PUT' : 'POST',
                    body: {
                      requestId,
                      values,
                      expectedRevision: selected?.expense.revision,
                      frequency,
                      nextDueOn,
                      reconcilesExpenseIds,
                    },
                  });
                  setSelected(saved);
                  setEditing(false);
                  reload();
                })
              }
            />
          ) : null}
          {selected && !editing ? (
            <section className="card expense-detail">
              <header className="page-header">
                <h2>
                  #{selected.expense.id} {selected.expense.name}
                </h2>
                <button onClick={() => setSelected(null)}>닫기</button>
              </header>
              <dl>
                <dt>결제일</dt>
                <dd>{selected.expense.paidOn ?? '미결제'}</dd>
                <dt>공급가 / 세액 / 합계 (원금)</dt>
                <dd>
                  {selected.expense.netAmount ?? '미확인'} /{' '}
                  {selected.expense.taxAmount ?? '미확인'} /{' '}
                  {selected.expense.grossAmount} {selected.expense.currency}
                </dd>
                <dt>통화 환산</dt>
                <dd>
                  {selected.expense.convertedCurrency
                    ? `${selected.expense.convertedCurrency} · 환율 ${selected.expense.exchangeRate} · 기준일 ${selected.expense.exchangeRateOn}`
                    : '미적용'}
                </dd>
                <dt>청구서 번호 / 결제 수단</dt>
                <dd>
                  {selected.expense.invoiceReference ?? '없음'} /{' '}
                  {selected.expense.paymentMethod}
                </dd>
                <dt>메모</dt>
                <dd>{selected.expense.memo ?? '없음'}</dd>
                <dt>Azure 원본</dt>
                <dd>
                  {selected.expense.environment}{' '}
                  {selected.expense.subscriptionId}{' '}
                  {selected.expense.resourceGroup}{' '}
                  {selected.expense.serviceName}{' '}
                  {selected.expense.rawImportedAmount}
                </dd>
              </dl>
              {selected.expense.source !== 'Azure' ? (
                <div className="tabs">
                  <button disabled={busy} onClick={() => setEditing(true)}>
                    수정
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          '비용을 삭제할까요? 감사 이력은 보존되고 증빙 접근은 즉시 차단됩니다.',
                        )
                      )
                        void action(async () => {
                          await api({
                            path: `${expenseBase}/${selected.expense.id}?revision=${selected.expense.revision}`,
                            method: 'DELETE',
                          });
                          setSelected(null);
                          reload();
                        });
                    }}
                  >
                    삭제
                  </button>
                </div>
              ) : (
                <p className="muted">
                  Azure 금액은 원본 재수집으로 정정합니다. 실제 Microsoft Azure
                  청구서를 별도로 등록하고 대사할 사용량 ID를 지정하세요.
                </p>
              )}
              <h3>증빙</h3>
              <p className="muted">
                PDF/PNG/JPEG, 최대 10 MiB · 원본 보존 · 관리자 인증 다운로드
              </p>
              {!config.evidenceScanningConfigured ? (
                <p>악성 파일 검사기 미설정: 업로드가 차단됩니다.</p>
              ) : null}
              <label>
                증빙 파일
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={busy || !config.evidenceScanningConfigured}
                  onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (!file) return;
                    if (file.size > 10 * 1024 * 1024) {
                      setError('증빙은 최대 10 MiB입니다.');
                      return;
                    }
                    const form = new FormData();
                    form.set('requestId', crypto.randomUUID());
                    form.set('file', file);
                    void action(async () => {
                      await api({
                        path: `${expenseBase}/${selected.expense.id}/attachments`,
                        method: 'POST',
                        body: form,
                      });
                      await refreshSelection(selected.expense.id);
                    });
                  }}
                />
              </label>
              <ul>
                {selected.attachments.map(file => (
                  <li key={file.id}>
                    {file.fileName} ({file.bytes.toLocaleString()} B){' '}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const blob = await api<Blob>({
                            path: `${expenseBase}/${selected.expense.id}/attachments/${file.id}`,
                            responseType: 'blob',
                          });
                          downloadBlob(blob, file.fileName);
                        })
                      }
                    >
                      다운로드
                    </button>{' '}
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('이 증빙을 삭제할까요?'))
                          void action(async () => {
                            await api({
                              path: `${expenseBase}/${selected.expense.id}/attachments/${file.id}`,
                              method: 'DELETE',
                            });
                            await refreshSelection(selected.expense.id);
                          });
                      }}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const rows = await api<Audit[]>({
                      path: `${expenseBase}/${selected.expense.id}/audit`,
                    });
                    setAudits(rows);
                    setAuditTarget(selected.expense.id);
                    setAuditLookup(String(selected.expense.id));
                    setAuditMore(rows.length === 100);
                  })
                }
              >
                수정·삭제 이력
              </button>
            </section>
          ) : null}
          <section className="card expense-detail">
            <h2>비용 감사 이력</h2>
            <p className="muted">
              삭제한 비용도 원본 ID로 조회할 수 있습니다. 운영자 변경과 시스템
              수집 이력을 보존합니다.
            </p>
            <div className="expense-filters">
              <label>
                비용 ID
                <input
                  type="number"
                  min={1}
                  value={auditLookup}
                  onChange={e => setAuditLookup(e.target.value)}
                />
              </label>
              <button
                disabled={
                  busy ||
                  !Number.isSafeInteger(Number(auditLookup)) ||
                  Number(auditLookup) <= 0
                }
                onClick={() =>
                  void action(async () => {
                    const id = Number(auditLookup);
                    const rows = await api<Audit[]>({
                      path: `${expenseBase}/${id}/audit`,
                    });
                    setAuditTarget(id);
                    setAudits(rows);
                    setAuditMore(rows.length === 100);
                  })
                }
              >
                이력 조회
              </button>
            </div>
            <ul>
              {audits.map(audit => (
                <li key={audit.id}>
                  <details>
                    <summary>
                      {audit.createdAtUtc} · {audit.action} ·{' '}
                      {audit.adminUserId
                        ? `관리자 #${audit.adminUserId}`
                        : '시스템'}
                    </summary>
                    <pre>{audit.beforeJson ?? '신규'}</pre>
                    <pre>{audit.afterJson ?? '삭제'}</pre>
                  </details>
                </li>
              ))}
            </ul>
            {auditMore && audits.length > 0 && auditTarget ? (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const rows = await api<Audit[]>({
                      path: `${expenseBase}/${auditTarget}/audit?cursor=${
                        audits.at(-1)!.id
                      }`,
                    });
                    setAudits([...audits, ...rows]);
                    setAuditMore(rows.length === 100);
                  })
                }
              >
                이전 이력
              </button>
            ) : null}
          </section>
          <section className="card">
            <header className="page-header">
              <h2>반복 결제 예정</h2>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const through = new Date();
                    through.setDate(through.getDate() + 30);
                    await api({
                      path: `${expenseBase}/schedules/project`,
                      method: 'POST',
                      body: { through: through.toLocaleDateString('sv-SE') },
                    });
                    reload();
                  })
                }
              >
                30일 내 예정 비용 생성
              </button>
            </header>
            <p className="muted">
              예정 내역은 결제 완료로 처리하지 않습니다. Apple Developer
              연회비는 수동 등록하며, 결제 확인이 필요한 예정 건은 아래 알림에서
              확인합니다. 외부 알림은 발송하지 않습니다.
            </p>
            <ul>
              {schedules
                .filter(row => row.schedule.isEnabled)
                .map(row => (
                  <li key={row.schedule.id}>
                    <strong>
                      {row.schedule.nextDueOn <= today
                        ? '결제일 확인 필요 · '
                        : ''}
                      {row.name}
                    </strong>{' '}
                    · {row.schedule.frequency === 'Monthly' ? '매월' : '매년'} ·
                    다음 생성일 {row.schedule.nextDueOn} ·{' '}
                    {money(row.grossAmount, row.currency)}{' '}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api({
                            path: `${expenseBase}/schedules/${row.schedule.id}?revision=${row.schedule.revision}`,
                            method: 'DELETE',
                          });
                          reload();
                        })
                      }
                    >
                      반복 중지
                    </button>
                  </li>
                ))}
            </ul>
          </section>
          <section className="card expense-detail">
            <h2>결제 확인 알림 · 지난 예정일 / 30일 이내</h2>
            <p className="muted">
              미확인 수동·반복 예정 비용입니다. 실제 결제를 확인한 뒤 결제
              완료로 수정하세요. 일정의 다음 생성일이 넘어가도 이 알림은
              유지됩니다. 최대 100건을 오래된 순서로 표시합니다.
            </p>
            {dueCosts.length === 0 ? <p>확인할 예정 비용이 없습니다.</p> : null}
            <ul>
              {dueCosts.map(row => (
                <li key={row.expense.id}>
                  <strong>
                    {row.expense.occurredOn <= today
                      ? '결제 확인 필요'
                      : '예정'}{' '}
                    · {row.expense.occurredOn}
                  </strong>{' '}
                  · {row.expense.name} ·{' '}
                  {money(row.expense.grossAmount, row.expense.currency)}{' '}
                  <button onClick={() => open(row)}>예정 상세</button>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2>Azure 비용 동기화</h2>
            <p className="muted">
              서비스·일별 사용량, 원청구 통화 유지. 일반적으로 8–24시간, 구독
              유형에 따라 최대 72시간 지연될 수 있으며 청구 마감 전 정정됩니다.
              수동 청구서와 대사한 사용량은 합계에서 제외합니다.
            </p>
            <div className="expense-filters">
              <label>
                환경 / 리소스 그룹
                <select value={scope} onChange={e => setScope(e.target.value)}>
                  {config.azureScopes.map(s => (
                    <option key={s.scope} value={s.scope}>
                      {s.environment} · {s.scope.split('/').at(-1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                수집 월
                <input
                  type="month"
                  value={month}
                  max={today.slice(0, 7)}
                  onChange={e => setMonth(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !config.azureSyncEnabled || !scope || !month}
                onClick={() =>
                  void action(async () => {
                    try {
                      await api({
                        path: `${expenseBase}/sync`,
                        method: 'POST',
                        body: { scope, month: `${month}-01` },
                      });
                    } finally {
                      reload();
                    }
                  })
                }
              >
                수동 동기화
              </button>
            </div>
            {!config.azureSyncEnabled ? (
              <p>자동 수집 비활성화 · 승인 전 Job 배포 없음</p>
            ) : null}
            <ul>
              {runs.map(run => (
                <li key={run.id}>
                  {run.environment} · {run.month.slice(0, 7)} · {run.status} ·
                  마지막 성공 {run.lastSuccessAtUtc ?? '없음'} ·{' '}
                  {run.failureCode ?? ''}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </>
  );
}

function ExpenseBreakdowns({ summary }: { summary: Summary }) {
  return (
    <div className="charts">
      {Object.entries({
        '월별 지출 추이': summary.months,
        '카테고리별 지출': summary.categories,
        '서비스별 지출': summary.services,
      }).map(([title, rows]) => (
        <figure className="chart" key={title}>
          <figcaption>{title}</figcaption>
          {summary.totals.map(total => {
            const selected = rows
              .filter(
                row =>
                  row.currency === total.currency &&
                  row.status === total.status,
              )
              .sort((a, b) => a.label.localeCompare(b.label));
            const maximum = Math.max(
              1,
              ...selected.map(row => Math.abs(row.gross)),
            );
            return (
              <div key={`${total.currency}-${total.status}`}>
                <h3>
                  {total.currency} · {statuses[total.status]}
                </h3>
                <dl className="expense-bars">
                  {selected.map(row => (
                    <div key={row.label}>
                      <dt>
                        {categories[row.label as keyof typeof categories] ??
                          row.label}
                      </dt>
                      <dd>{money(row.gross, row.currency)}</dd>
                      <meter
                        aria-label={`${row.label} ${row.gross} ${row.currency}`}
                        min={0}
                        max={maximum}
                        value={Math.abs(row.gross)}
                      />
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </figure>
      ))}
    </div>
  );
}

function ExpenseEditor({
  row,
  today,
  busy,
  onCancel,
  onSave,
}: {
  row: ExpenseRow | null;
  today: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (
    values: ExpenseValues,
    requestId: string,
    frequency: string | null,
    nextDueOn: string | null,
    reconcilesExpenseIds?: number[],
  ) => Promise<void>;
}) {
  const [values, setValues] = useState<ExpenseValues>(() =>
    row ? { ...row.expense } : blankExpense(today),
  );
  const [requestId] = useState(
    () => row?.expense.requestId ?? crypto.randomUUID(),
  );
  const [frequency, setFrequency] = useState('');
  const [due, setDue] = useState('');
  const [reconcile, setReconcile] = useState('');
  const [replaceReconcile, setReplaceReconcile] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const field = <K extends keyof ExpenseValues>(
    key: K,
    value: ExpenseValues[K],
  ) => setValues(previous => ({ ...previous, [key]: value }));
  return (
    <form
      className="card"
      onSubmit={event => {
        event.preventDefault();
        const error = validateExpense(values);
        if (error) {
          setValidation(error);
          return;
        }
        if (frequency && !due) {
          setValidation('다음 결제 예정일을 입력하세요.');
          return;
        }
        if (
          replaceReconcile &&
          reconcile &&
          !/^\d+(\s*,\s*\d+)*$/.test(reconcile)
        ) {
          setValidation('대사할 사용량 ID를 쉼표로 구분해 입력하세요.');
          return;
        }
        setValidation(null);
        void onSave(
          values,
          requestId,
          frequency || null,
          frequency ? due : null,
          replaceReconcile
            ? reconcile
              ? reconcile.split(',').map(Number)
              : []
            : undefined,
        );
      }}
    >
      <h2>{row ? '비용 수정' : '신규 비용'}</h2>
      {validation ? <p role="alert">{validation}</p> : null}
      <fieldset disabled={busy}>
        <div className="expense-form">
          {(
            [
              'name',
              'provider',
              'paymentMethod',
              'currency',
              'invoiceReference',
            ] as const
          ).map(key => (
            <label key={key}>
              {
                {
                  name: '비용 이름',
                  provider: '공급자',
                  paymentMethod: '결제 수단',
                  currency: '통화 (ISO)',
                  invoiceReference: '청구서 / 영수증 번호',
                }[key]
              }
              <input
                required={key !== 'invoiceReference'}
                maxLength={
                  key === 'currency' ? 3 : key === 'paymentMethod' ? 80 : 200
                }
                value={values[key] ?? ''}
                onChange={e =>
                  field(
                    key,
                    key === 'invoiceReference'
                      ? e.target.value || null
                      : key === 'currency'
                      ? e.target.value.toUpperCase()
                      : e.target.value,
                  )
                }
              />
            </label>
          ))}
          <label>
            카테고리
            <select
              value={values.category}
              onChange={e =>
                field('category', e.target.value as ExpenseValues['category'])
              }
            >
              {Object.entries(categories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            결제 상태
            <select
              value={values.status}
              onChange={e =>
                field('status', e.target.value as ExpenseValues['status'])
              }
            >
              {Object.entries(statuses).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            거래 유형
            <select
              value={values.kind}
              onChange={e =>
                field('kind', e.target.value as ExpenseValues['kind'])
              }
            >
              <option value="Charge">비용</option>
              <option value="Refund">환불</option>
              <option value="Adjustment">정정</option>
            </select>
          </label>
          {(['occurredOn', 'paidOn', 'exchangeRateOn'] as const).map(key => (
            <label key={key}>
              {
                {
                  occurredOn: '발생일',
                  paidOn: '실제 결제일',
                  exchangeRateOn: '환율 기준일',
                }[key]
              }
              <input
                required={key === 'occurredOn'}
                type="date"
                value={values[key] ?? ''}
                onChange={e =>
                  field(
                    key,
                    e.target.value || (key === 'occurredOn' ? '' : null),
                  )
                }
              />
            </label>
          ))}
          {(
            ['netAmount', 'taxAmount', 'grossAmount', 'exchangeRate'] as const
          ).map(key => (
            <label key={key}>
              {
                {
                  netAmount: '공급가액 (모르면 공란)',
                  taxAmount: '세액 (모르면 공란)',
                  grossAmount: '합계 (원금)',
                  exchangeRate: '적용 환율',
                }[key]
              }
              <input
                inputMode="decimal"
                required={key === 'grossAmount'}
                value={values[key] ?? ''}
                onChange={e =>
                  field(
                    key,
                    e.target.value || (key === 'grossAmount' ? '' : null),
                  )
                }
              />
            </label>
          ))}
          <label>
            환산 통화
            <input
              maxLength={3}
              value={values.convertedCurrency ?? ''}
              onChange={e =>
                field('convertedCurrency', e.target.value.toUpperCase() || null)
              }
            />
          </label>
          <label>
            환불 원본 비용 ID
            <input
              type="number"
              min={1}
              value={values.originalExpenseId ?? ''}
              onChange={e =>
                field(
                  'originalExpenseId',
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </label>
          {!row ? (
            <>
              <label>
                반복
                <select
                  value={frequency}
                  onChange={e => setFrequency(e.target.value)}
                >
                  <option value="">일회성</option>
                  <option value="Monthly">매월</option>
                  <option value="Yearly">매년</option>
                </select>
              </label>
              <label>
                다음 결제 예정일
                <input
                  type="date"
                  value={due}
                  onChange={e => setDue(e.target.value)}
                />
              </label>
            </>
          ) : null}
          <label className="expense-wide">
            메모
            <textarea
              maxLength={2000}
              value={values.memo ?? ''}
              onChange={e => field('memo', e.target.value || null)}
            />
          </label>
          <label className="expense-wide">
            <span>
              <input
                type="checkbox"
                checked={replaceReconcile}
                onChange={e => setReplaceReconcile(e.target.checked)}
              />{' '}
              Azure 사용량 대사 목록 지정 / 교체
            </span>
            <input
              disabled={!replaceReconcile}
              placeholder="사용량 비용 ID (쉼표 구분)"
              value={reconcile}
              onChange={e => setReconcile(e.target.value)}
            />
            <small>
              동일 통화의 결제 완료 Microsoft Azure 청구서에 연결합니다. 대사된
              추정 사용량은 집계에서 제외됩니다. 체크 후 공란 저장하면 기존
              대사를 해제합니다.
            </small>
          </label>
        </div>
        <div className="tabs">
          <button type="submit">저장</button>
          <button type="button" onClick={onCancel}>
            취소
          </button>
        </div>
      </fieldset>
    </form>
  );
}
