'use client';

import { useState } from 'react';
import { RANGE_OPTIONS, customPeriodProblem, seoulToday, type Period } from '../../../lib/adminV2';

/** The V2 page title row: a small eyebrow, the title and optional actions on the end side. */
export function PageTitle({ title, eyebrow, description, actions }: { readonly title: string; readonly eyebrow?: string; readonly description?: string; readonly actions?: React.ReactNode }) {
  return (
    <header className="v2-page-title">
      <div>
        {eyebrow ? <p className="v2-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="v2-muted">{description}</p> : null}
      </div>
      {actions ? <div className="v2-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({ title, actions, children, className }: { readonly title?: React.ReactNode; readonly actions?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <section className={`v2-panel${className ? ` ${className}` : ''}`}>
      {title || actions ? (
        <div className="v2-panel-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions ? <div className="v2-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Loading, failure (with retry) and empty, each distinct - an empty result is never shown as a failure, nor the reverse. */
export function LoadState({ loading, error, onRetry, empty, emptyText, lines = 3 }: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry?: () => void;
  readonly empty?: boolean;
  readonly emptyText?: string;
  readonly lines?: number;
}) {
  if (error) {
    return (
      <div className="v2-state v2-state-error" role="alert">
        <p>{error}</p>
        {onRetry ? <button onClick={onRetry} type="button">다시 시도</button> : null}
      </div>
    );
  }
  if (loading) {
    return (
      <div aria-label="불러오는 중" className="v2-skeleton" role="status">
        {Array.from({ length: lines }, (_, index) => <span key={index} style={{ width: `${92 - index * 14}%` }} />)}
      </div>
    );
  }
  return empty ? <p className="v2-state">{emptyText ?? '표시할 데이터가 없습니다.'}</p> : null;
}

/** A row of mutually exclusive choices (a radio group drawn as pills). */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <div aria-label={label} className="v2-segmented" role="radiogroup">
      {options.map(option => (
        <button aria-checked={option.value === value} key={option.value} onClick={() => onChange(option.value)} role="radio" type="button">
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 7일 / 30일 / 90일 / 사용자 지정 - Seoul calendar days; a custom period is checked before it is requested. */
export function PeriodControl({ period, onChange }: { readonly period: Period; readonly onChange: (period: Period) => void }) {
  const today = seoulToday();
  const [custom, setCustom] = useState(period.range === 'custom');
  const [from, setFrom] = useState(period.from ?? '');
  const [through, setThrough] = useState(period.through ?? today);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="v2-period">
      <div aria-label="기간" className="v2-segmented" role="radiogroup">
        {RANGE_OPTIONS.map(option => (
          <button
            aria-checked={!custom && period.range === option.range}
            key={option.range}
            onClick={() => {
              setCustom(false);
              setProblem(null);
              onChange({ range: option.range });
            }}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
        <button aria-checked={custom} onClick={() => setCustom(true)} role="radio" type="button">
          사용자 지정
        </button>
      </div>
      {custom ? (
        <form
          className="v2-period-custom"
          onSubmit={event => {
            event.preventDefault();
            const issue = customPeriodProblem(from, through, today);
            setProblem(issue);
            if (!issue) {
              onChange({ range: 'custom', from, through });
            }
          }}
        >
          <label>
            시작일
            <input max={today} onChange={event => setFrom(event.target.value)} type="date" value={from} />
          </label>
          <label>
            종료일
            <input max={today} onChange={event => setThrough(event.target.value)} type="date" value={through} />
          </label>
          <button className="primary" type="submit">적용</button>
          {problem ? <p className="v2-field-error" role="alert">{problem}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
