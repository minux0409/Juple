'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { daysEnding, periodQuery, selectedPeriod, seoulToday, validatePeriod, type Period } from '../../../lib/workspace';

const Context = createContext<{ period: Period; select: (p: Period) => void } | null>(null);
export function WorkspaceDates({ children }: { children: React.ReactNode }) {
  const [period, setPeriod] = useState(() => selectedPeriod(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)));
  useEffect(() => {
    const restore = () => setPeriod(selectedPeriod(new URLSearchParams(window.location.search)));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const select = (p: Period) => {
    setPeriod(p);
    const url = new URL(window.location.href);
    url.searchParams.set('from', p.from); url.searchParams.set('through', p.through);
    window.history.replaceState(null, '', url);
  };
  return <Context.Provider value={{ period, select }}>{children}</Context.Provider>;
}
export function useWorkspaceDates() {
  const value = useContext(Context);
  if (!value) throw new Error('WorkspaceDates provider required');
  return value;
}
export function workspaceHref(path: string, period: Period) { return `${path}?${periodQuery(period)}`; }
export function PeriodPicker() {
  const { period, select } = useWorkspaceDates();
  return <PeriodForm key={`${period.from}:${period.through}`} period={period} select={select} />;
}
function PeriodForm({ period, select }: { period: Period; select: (p: Period) => void }) {
  const [draft, setDraft] = useState(period);
  const [error, setError] = useState<string | null>(null);
  const choose = (p: Period) => { setDraft(p); setError(null); select(p); };
  return <section className="period-picker" aria-label="한국 시간 조회 기간">
    <div className="period-presets">{[[1, '오늘'], [7, '최근 7일'], [30, '최근 30일'], [90, '최근 90일']].map(([days, label]) => {
      const p = daysEnding(seoulToday(), Number(days));
      return <button key={days} type="button" aria-pressed={p.from === period.from && p.through === period.through} onClick={() => choose(p)}>{label}</button>;
    })}</div>
    <form onSubmit={e => { e.preventDefault(); const message = validatePeriod(draft); setError(message); if (!message) choose(draft); }}>
      <label>시작일<input type="date" value={draft.from} max={seoulToday()} onChange={e => setDraft({ ...draft, from: e.target.value })} required /></label>
      <label>종료일<input type="date" value={draft.through} max={seoulToday()} onChange={e => setDraft({ ...draft, through: e.target.value })} required /></label>
      <button type="submit">기간 적용</button>
    </form>
    <small>Asia/Seoul · 시작일 00:00 이상, 종료일 다음 날 00:00 미만 · 최대 366일</small>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
