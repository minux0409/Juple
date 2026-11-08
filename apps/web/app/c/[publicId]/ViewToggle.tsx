'use client';

export type ViewMode = 'list' | 'grid' | 'image';

interface ViewToggleProps {
  readonly value: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
  readonly labels: { readonly group: string; readonly list: string; readonly grid: string; readonly image: string };
}

/** The mobile ViewModeToggle (components/ViewModeToggle.tsx, `tinted`): three lines (List), four blocks (Grid), nine blocks (Image). */
export function ViewToggle({ value, onChange, labels }: ViewToggleProps) {
  const option = (mode: ViewMode, label: string, glyph: React.ReactNode) => (
    <button
      aria-label={label}
      aria-pressed={value === mode}
      className={value === mode ? 'viewOption viewOptionSelected' : 'viewOption'}
      onClick={() => onChange(mode)}
      title={label}
      type="button"
    >
      {glyph}
    </button>
  );
  return (
    <div aria-label={labels.group} className="viewToggle" role="group">
      {option('list', labels.list, <span aria-hidden className="glyphList"><i /><i /><i /></span>)}
      {option('grid', labels.grid, <span aria-hidden className="glyphGrid"><i /><i /><i /><i /></span>)}
      {option('image', labels.image, <span aria-hidden className="glyphImage">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>)}
    </div>
  );
}
