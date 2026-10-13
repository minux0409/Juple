'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { nextActiveIndex } from '../../lib/listNavigation';
import { Glyph } from './Glyph';
import styles from './app.module.css';

/** Below the trigger, or above it when there is not enough room underneath; right edges aligned (start edge in RTL). */
type Placement = { readonly top: number; readonly left: number; readonly minWidth: number; readonly above: boolean };

const GAP = 6;

/**
 * The floating panel behind a pill or ⋯ button: opened by its trigger, closed by Escape, a click outside, choosing, or the page
 * scrolling under it; focus returns to the trigger. Drawn with position: fixed from the trigger's own box, so a scrolling list or a
 * dialog body (the share rail) never clips it.
 */
function useFloating(open: boolean, onClose: () => void) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) {
      return;
    }
    const box = trigger.getBoundingClientRect();
    const height = panel.offsetHeight;
    const width = Math.max(panel.offsetWidth, box.width);
    const above = box.bottom + GAP + height > window.innerHeight && box.top - GAP - height > 0;
    const rtl = getComputedStyle(trigger).direction === 'rtl';
    const left = rtl ? box.left : box.right - width;
    setPlacement({ top: above ? box.top - GAP - height : box.bottom + GAP, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), minWidth: box.width, above });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        closeRef.current();
      }
    };
    const scrolled = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        closeRef.current();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', closeRef.current);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', closeRef.current);
    };
  }, [open]);

  return { triggerRef, panelRef, placement: open ? placement : null };
}

export interface ListOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * A choice drawn as a pill with a chevron that opens a small panel in the same look (the participant role): a real button +
 * listbox (aria-haspopup / aria-expanded / aria-controls, aria-activedescendant, options with aria-selected), operated with the arrows,
 * Home / End, Enter / Space and Escape, and closed by a click outside. The chosen row carries a check. Fixed width - a longer label or
 * the busy state never moves the row it sits in.
 */
export function PillListbox<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  busy = false,
}: {
  readonly value: T;
  readonly options: readonly ListOption<T>[];
  readonly onChange: (value: T) => void;
  /** The accessible name (e.g. "다른참여자 권한"). */
  readonly label: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const close = useCallback(() => setOpen(false), []);
  const { triggerRef, panelRef, placement } = useFloating(open, close);
  const current = options.find(option => option.value === value);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  const shut = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) {
      return;
    }
    shut(true);
    if (option.value !== value) {
      onChange(option.value);
    }
  };

  useEffect(() => {
    if (open && placement) {
      panelRef.current?.focus();
    }
  }, [open, panelRef, placement]);

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(Math.max(0, options.findIndex(option => option.value === value)));
    }
  };
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') {
        event.preventDefault();
        // The panel only - never the dialog it sits in.
        event.stopPropagation();
      }
      shut(event.key === 'Escape');
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(active);
      return;
    }
    const next = nextActiveIndex(active, event.key, options.map(option => option.disabled === true));
    if (next !== active) {
      event.preventDefault();
      setActive(next);
    }
  };

  return (
    <span aria-busy={busy} className={busy ? `${styles.roleControl} ${styles.roleControlBusy}` : styles.roleControl} data-role-control>
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}: ${current?.label ?? ''}`}
        aria-disabled={disabled || undefined}
        className={styles.pillButton}
        onClick={() => {
          if (disabled) {
            return;
          }
          if (open) {
            shut(false);
          } else {
            openAt(Math.max(0, options.findIndex(option => option.value === value)));
          }
        }}
        onKeyDown={event => {
          if (!disabled) {
            onTriggerKey(event);
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span className={styles.pillButtonLabel}>{current?.label ?? ''}</span>
        <Glyph className={styles.roleControlChevron} name="Chevron" size={14} />
      </button>
      {open ? (
        <div
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label={label}
          className={styles.floatingPanel}
          data-above={placement?.above ? 'true' : undefined}
          id={listId}
          onKeyDown={onListKey}
          ref={panelRef}
          role="listbox"
          style={placement ? { top: placement.top, left: placement.left, minWidth: placement.minWidth } : { visibility: 'hidden' }}
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <div
              aria-disabled={option.disabled === true}
              aria-selected={option.value === value}
              className={index === active ? `${styles.floatingRow} ${styles.floatingRowActive}` : styles.floatingRow}
              id={`${listId}-${index}`}
              key={option.value}
              onClick={() => choose(index)}
              onPointerMove={() => !option.disabled && setActive(index)}
              role="option"
            >
              <span>{option.label}</span>
              {option.value === value ? <Glyph className={styles.floatingCheck} name="Check" size={16} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

export interface MenuAction {
  readonly key: string;
  readonly label: string;
  readonly icon?: Parameters<typeof Glyph>[0]['name'];
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/**
 * The ⋯ menu of a Collection or a link (mobile ActionMenuDialog, as a desktop popover): a button + menu (aria-haspopup="menu",
 * aria-expanded, aria-controls), its items operated with the arrows, Home / End, Enter / Space, Escape and a click outside; focus
 * returns to ⋯. A destructive item is red, last. Draws nothing when there is nothing to offer.
 */
export function ActionMenu({ label, actions, className }: { readonly label: string; readonly actions: readonly MenuAction[]; readonly className?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  const { triggerRef, panelRef, placement } = useFloating(open, close);

  useEffect(() => {
    if (open && placement) {
      panelRef.current?.focus();
    }
  }, [open, panelRef, placement]);

  if (actions.length === 0) {
    return null;
  }
  const shut = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  };
  const run = (index: number) => {
    const action = actions[index];
    if (!action || action.disabled) {
      return;
    }
    shut(true);
    action.onSelect();
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
      shut(event.key === 'Escape');
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      run(active);
      return;
    }
    const next = nextActiveIndex(active, event.key, actions.map(action => action.disabled === true));
    if (next !== active) {
      event.preventDefault();
      setActive(next);
    }
  };

  return (
    <span className={styles.menuAnchor}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={className ?? styles.iconButton}
        data-action-menu
        onClick={() => {
          if (open) {
            shut(false);
          } else {
            setActive(nextActiveIndex(-1, 'Home', actions.map(action => action.disabled === true)));
            setOpen(true);
          }
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive(nextActiveIndex(-1, 'Home', actions.map(action => action.disabled === true)));
            setOpen(true);
          }
        }}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <Glyph name="More" size={20} />
      </button>
      {open ? (
        <div
          aria-activedescendant={`${menuId}-${active}`}
          aria-label={label}
          className={styles.floatingPanel}
          id={menuId}
          onKeyDown={onMenuKey}
          ref={panelRef}
          role="menu"
          style={placement ? { top: placement.top, left: placement.left, minWidth: Math.max(placement.minWidth, 200) } : { visibility: 'hidden' }}
          tabIndex={-1}
        >
          {actions.map((action, index) => (
            <div
              aria-disabled={action.disabled === true}
              className={[styles.floatingRow, index === active ? styles.floatingRowActive : '', action.destructive ? styles.floatingRowDanger : ''].filter(Boolean).join(' ')}
              data-menu-action={action.key}
              id={`${menuId}-${index}`}
              key={action.key}
              onClick={() => run(index)}
              onPointerMove={() => !action.disabled && setActive(index)}
              role="menuitem"
            >
              {action.icon ? <Glyph name={action.icon} size={18} /> : null}
              <span>{action.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}
