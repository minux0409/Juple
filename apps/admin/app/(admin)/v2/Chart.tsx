'use client';

import { memo, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { DEFAULT_FRAME, compactNumber, indexAt, labelIndexes, plot, type ChartFrame } from '../../../lib/charts';

/** A shorter chart for a half-height panel (the 사용자 screen). */
const COMPACT_FRAME: ChartFrame = { ...DEFAULT_FRAME, height: 190 };

export interface ChartProps {
  /** One label per value (a yyyy-MM-dd day or a month), in order. */
  readonly labels: readonly string[];
  /** null = not measured (a gap, "미집계"), never zero. */
  readonly values: readonly (number | null)[];
  readonly kind: 'line' | 'bar';
  /** Accessible name of the chart. */
  readonly title: string;
  readonly formatValue: (value: number) => string;
  /** The tooltip's date ("10월 28일"). */
  readonly formatLabel: (label: string) => string;
  /** The axis' date ("10/28"). */
  readonly axisLabel: (label: string) => string;
  /** false: a cumulative line may start above zero so its changes stay visible. */
  readonly fromZero?: boolean;
  readonly unmeasuredText?: string;
  /** The data table's toggle ("날짜별 값 보기"; a monthly chart says "월별 값 보기"). */
  readonly dataLabel?: string;
  readonly compact?: boolean;
}

/**
 * One series as a line or bars, with a tooltip for the hovered / touched / keyboard-selected point (arrow keys, Home, End).
 * The exact values are also in a data table for screen readers and narrow screens.
 */
export const Chart = memo(function Chart({ labels, values, kind, title, formatValue, formatLabel, axisLabel, fromZero = true, unmeasuredText = '미집계', dataLabel = '날짜별 값 보기', compact = false }: ChartProps) {
  const frame = compact ? COMPACT_FRAME : DEFAULT_FRAME;
  const geometry = useMemo(() => plot(values, frame, { fromZero: kind === 'bar' ? true : fromZero }), [values, frame, kind, fromZero]);
  const axis = useMemo(() => labelIndexes(labels.length, 7), [labels.length]);
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = useId().replace(/:/g, '');
  const baseline = frame.height - frame.bottom;

  const pointAt = (event: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) {
      return;
    }
    setActive(indexAt(((event.clientX - box.left) / box.width) * frame.width, values.length, frame));
  };

  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const last = values.length - 1;
    const current = active ?? last;
    const next =
      event.key === 'ArrowLeft' ? Math.max(0, current - 1)
      : event.key === 'ArrowRight' ? Math.min(last, current + 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  };

  const shown = active !== null ? geometry.points[active] : null;
  const barWidth = Math.max(2, Math.min(28, geometry.slot * 0.62));

  return (
    <div className="v2-chart">
      <svg
        aria-label={`${title}. 화살표 키로 날짜별 값을 확인할 수 있습니다.`}
        className="v2-chart-svg"
        onBlur={() => setActive(null)}
        onFocus={() => setActive(values.length > 0 ? values.length - 1 : null)}
        onKeyDown={onKey}
        onPointerDown={pointAt}
        onPointerLeave={event => {
          if (event.pointerType === 'mouse') {
            setActive(null);
          }
        }}
        onPointerMove={pointAt}
        ref={svgRef}
        role="img"
        tabIndex={0}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geometry.ticks.map(tick => (
          <g key={tick.y}>
            <line className="v2-chart-grid" x1={frame.left} x2={frame.width - frame.right} y1={tick.y} y2={tick.y} />
            <text className="v2-chart-axis" textAnchor="end" x={frame.left - 8} y={tick.y + 4}>
              {compactNumber(tick.value)}
            </text>
          </g>
        ))}
        {kind === 'bar'
          ? geometry.points.map(point =>
              point.y === null ? (
                // Not measured: a dashed outline at the base - never a bar of zero.
                <rect className="v2-chart-unmeasured" height={14} key={point.index} rx={3} width={barWidth} x={point.x - barWidth / 2} y={baseline - 14} />
              ) : (
                <rect
                  className={point.index === active ? 'v2-chart-bar active' : 'v2-chart-bar'}
                  height={Math.max(point.value === 0 ? 0 : 1.5, baseline - point.y)}
                  key={point.index}
                  rx={Math.min(4, barWidth / 3)}
                  width={barWidth}
                  x={point.x - barWidth / 2}
                  y={Math.min(point.y, baseline - (point.value === 0 ? 0 : 1.5))}
                />
              ),
            )
          : (
            <>
              <path d={geometry.area} fill={`url(#${gradientId})`} />
              <path className="v2-chart-line" d={geometry.line} />
            </>
          )}
        {shown ? (
          <g aria-hidden="true">
            <line className="v2-chart-cursor" x1={shown.x} x2={shown.x} y1={frame.top} y2={baseline} />
            {shown.y !== null && kind === 'line' ? <circle className="v2-chart-dot" cx={shown.x} cy={shown.y} r={5} /> : null}
          </g>
        ) : null}
        {axis.map(index => (
          <text className="v2-chart-axis" key={index} textAnchor="middle" x={geometry.points[index]?.x ?? 0} y={frame.height - 8}>
            {axisLabel(labels[index] ?? '')}
          </text>
        ))}
      </svg>
      {shown ? (
        <div
          aria-live="polite"
          className="v2-chart-tooltip"
          role="status"
          style={{ left: `${Math.min(88, Math.max(12, (shown.x / frame.width) * 100))}%` }}
        >
          <span>{formatLabel(labels[shown.index] ?? '')}</span>
          <strong>{shown.value === null ? unmeasuredText : formatValue(shown.value)}</strong>
        </div>
      ) : null}
      <details className="v2-chart-data">
        <summary>{dataLabel}</summary>
        <div className="v2-table-scroll">
          <table>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">값</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label, index) => (
                <tr key={label}>
                  <td>{formatLabel(label)}</td>
                  <td className="num">{values[index] === null ? unmeasuredText : formatValue(values[index] as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
});
