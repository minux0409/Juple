'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './app.module.css';

/**
 * The Web form of the mobile CollapsibleHeaderLayout: the page title and everything above this block scroll away with the content, and
 * this block (the page's search / sort / view controls) stays docked at the top of the window - under the narrow top bar on small
 * screens (--shell-top-offset, measured by the shell). Once docked it becomes a raised surface (`data-stuck`) so the content passing
 * under it stays readable; nothing about its size changes, so nothing below it jumps.
 */
export function StickyControls({ children, label }: { readonly children: ReactNode; readonly label?: string }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const offset = Number.parseFloat(getComputedStyle(node).getPropertyValue('--shell-top-offset')) || 0;
    // The sentinel sits right above the block: once it has scrolled under the top edge (and the top bar), the block is docked.
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < offset + 1), { rootMargin: `${-offset - 1}px 0px 0px 0px`, threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div aria-hidden className={styles.stickySentinel} ref={sentinel} />
      <div aria-label={label} className={styles.stickyControls} data-sticky-controls data-stuck={stuck ? 'true' : undefined} role={label ? 'region' : undefined}>
        {children}
      </div>
    </>
  );
}
