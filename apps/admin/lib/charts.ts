/**
 * Geometry for the Admin V2 charts (one line or bar series in an SVG view box). Pure functions: the component only draws what
 * these return. A null value is "not measured" - a gap in the line and no bar - never drawn as zero.
 */

export interface ChartFrame {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export const DEFAULT_FRAME: ChartFrame = { width: 800, height: 260, left: 48, right: 16, top: 16, bottom: 30 };

/** A round axis maximum (1, 2, 2.5, 5 x 10^n) at or above the largest value; at least 1 so a flat zero series still has an axis. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) {
      return step * magnitude;
    }
  }
  return 10 * magnitude;
}

/** A minimum just below the smallest value for a cumulative line, so its changes are visible; 0 when that is close anyway. */
export function niceMin(values: readonly (number | null)[]): number {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) {
    return 0;
  }
  const min = Math.min(...known);
  const max = Math.max(...known);
  if (min <= 0 || min < max * 0.5) {
    return 0;
  }
  const span = Math.max(1, max - min);
  const magnitude = 10 ** Math.floor(Math.log10(span));
  return Math.max(0, Math.floor((min - span * 0.2) / magnitude) * magnitude);
}

export interface PlottedPoint {
  readonly index: number;
  readonly x: number;
  readonly y: number | null;
  readonly value: number | null;
}

export interface LineGeometry {
  readonly points: readonly PlottedPoint[];
  /** "M x y L x y ..." - a new "M" after every gap. */
  readonly line: string;
  /** The filled area under each continuous run. */
  readonly area: string;
  readonly ticks: readonly { readonly y: number; readonly value: number }[];
  readonly min: number;
  readonly max: number;
  /** The width of one bar slot (also the hit area of a point). */
  readonly slot: number;
}

export function plot(values: readonly (number | null)[], frame: ChartFrame = DEFAULT_FRAME, options: { readonly fromZero?: boolean } = {}): LineGeometry {
  const plotWidth = frame.width - frame.left - frame.right;
  const plotHeight = frame.height - frame.top - frame.bottom;
  const known = values.filter((value): value is number => value !== null);
  const min = options.fromZero === false ? niceMin(values) : 0;
  const rawMax = known.length ? Math.max(...known) : 0;
  const max = Math.max(min + 1, niceMax(rawMax - min) + min);
  const count = Math.max(1, values.length);
  const slot = plotWidth / count;
  const yOf = (value: number) => frame.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const points = values.map((value, index) => ({
    index,
    x: frame.left + slot * index + slot / 2,
    y: value === null ? null : yOf(value),
    value,
  }));

  let line = '';
  let area = '';
  let run: PlottedPoint[] = [];
  const baseline = frame.top + plotHeight;
  const flush = () => {
    if (run.length > 0) {
      line += run.map((point, i) => `${i === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y!)}`).join(' ') + ' ';
      area += `M${round(run[0].x)} ${round(baseline)} ` + run.map(point => `L${round(point.x)} ${round(point.y!)}`).join(' ') + ` L${round(run[run.length - 1].x)} ${round(baseline)} Z `;
    }
    run = [];
  };
  for (const point of points) {
    if (point.y === null) {
      flush();
    } else {
      run.push(point);
    }
  }
  flush();

  const ticks = [0, 1, 2, 3, 4].map(step => {
    const value = min + ((max - min) * step) / 4;
    return { y: round(yOf(value)), value };
  });
  return { points, line: line.trim(), area: area.trim(), ticks, min, max, slot };
}

/** The point under an x position of the view box (pointer or touch), clamped to the series. */
export function indexAt(x: number, count: number, frame: ChartFrame = DEFAULT_FRAME): number {
  if (count <= 0) {
    return -1;
  }
  const plotWidth = frame.width - frame.left - frame.right;
  const index = Math.floor(((x - frame.left) / plotWidth) * count);
  return Math.min(count - 1, Math.max(0, index));
}

/** About `target` evenly spread label positions, always including the first and the last. */
export function labelIndexes(count: number, target = 7): number[] {
  if (count <= 0) {
    return [];
  }
  if (count <= target) {
    return Array.from({ length: count }, (_, i) => i);
  }
  const step = (count - 1) / (target - 1);
  const indexes = new Set<number>();
  for (let i = 0; i < target; i++) {
    indexes.add(Math.round(i * step));
  }
  return [...indexes].sort((a, b) => a - b);
}

/** A compact axis number: 1,234 / 12.3천 / 1.2만 (Korean operators). */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) {
    return `${trim(value / 100_000_000)}억`;
  }
  if (abs >= 10_000) {
    return `${trim(value / 10_000)}만`;
  }
  return Number.isInteger(value) ? value.toLocaleString('ko-KR') : trim(value);
}

function trim(value: number): string {
  return Number(value.toFixed(1)).toLocaleString('ko-KR');
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
