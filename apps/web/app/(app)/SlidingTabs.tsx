'use client';

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './app.module.css';

/**
 * A row of tabs with ONE selection pill that slides from the old tab to the new one (a short transform + width transition; none under
 * prefers-reduced-motion). The pill is measured from the selected tab (`aria-selected="true"`), so tabs of any width - a long translation, a count
 * badge - get a pill that fits them. A row wider than its container scrolls sideways (nothing is cut off) and keeps the selected tab in view.
 * The arrow keys move between tabs (mirrored in right-to-left languages); Home / End jump to the ends.
 */
export function SlidingTabs({ label, children, tourProps }: { readonly label: string; readonly children: ReactNode; readonly tourProps?: Readonly<Record<string, string>> }) {
  const ref = useRef<HTMLDivElement>(null);

  const measure = () => {
    const row = ref.current;
    const selected = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !selected) {
      return;
    }
    row.style.setProperty('--slide-x', `${selected.offsetLeft}px`);
    row.style.setProperty('--slide-w', `${selected.offsetWidth}px`);
    row.dataset.ready = 'true';
  };

  // After every render (the selection may have changed) and whenever the row or a tab changes size (fonts, language, badges).
  useLayoutEffect(() => {
    measure();
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  useEffect(() => {
    const row = ref.current;
    if (!row || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    row.querySelectorAll('[role="tab"]').forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (index < 0) {
      return;
    }
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : step !== 0 ? tabs[(index + step + tabs.length) % tabs.length] : null;
    if (target) {
      event.preventDefault();
      target.focus();
      target.click();
    }
  };

  return (
    <div {...tourProps} aria-label={label} className={styles.slideTabs} onKeyDown={onKeyDown} ref={ref} role="tablist">
      <span aria-hidden className={styles.slidePill} />
      {children}
    </div>
  );
}
