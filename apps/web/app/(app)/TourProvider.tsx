'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatMessage, type AppDictionary } from '../../lib/appI18n';
import {
  findTourGuide,
  findTourTarget,
  isOnRoute,
  placeCard,
  sameRect,
  parseCornerRadius,
  spotlightFor,
  spotlightRadius,
  TOUR_FIND_INTERVAL_MS,
  TOUR_FIND_TIMEOUT_MS,
  type GuideId,
  type Rect,
  type Size,
  type StepKey,
  type TourGuide,
} from '../../lib/tour';
import { useSignedInApp } from './AppRoot';
import styles from './app.module.css';

interface TourContextValue {
  /** Starts a guide from its first step (a running tour is replaced). */
  readonly start: (guideId: GuideId) => void;
  readonly isRunning: boolean;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const value = useContext(TourContext);
  if (!value) {
    throw new Error('useTour must be used inside TourProvider');
  }
  return value;
}

/** The text of one step (the mobile app's own strings, in the page's language). */
export function tourStepText(dictionary: AppDictionary, key: StepKey): { readonly title: string; readonly body: string } {
  return { title: dictionary[`tourStep_${key}_Title`], body: dictionary[`tourStep_${key}_Body`] };
}

/**
 * Owns the one running tour of the signed-in app and draws it over the page. Help starts guides with useTour().start(id); only an explicit server new-account signal starts the main guide automatically.
 * Each step is its own component instance (keyed), so every step starts with a clean "looking for the target" state.
 */
export function TourProvider({ children }: { readonly children: React.ReactNode }) {
  const { isNewAccount, account } = useSignedInApp();
  const autoStarted = useRef(false);
  const [running, setRunning] = useState<{ readonly guide: TourGuide; readonly index: number } | null>(null);
  const returnFocusTo = useRef<Element | null>(null);

  const start = useCallback((guideId: GuideId) => {
    const guide = findTourGuide(guideId);
    if (guide) {
      setRunning(current => {
        if (!current) {
          returnFocusTo.current = document.activeElement;
        }
        return { guide, index: 0 };
      });
    }
  }, []);

  // Only the server transaction which actually created this account opts in. Existing accounts and old APIs fail closed.
  // Account existence is the durable cross-device once guard; local storage also records this browser's tour outcome.
  useEffect(() => {
    if (!isNewAccount || autoStarted.current) return;
    try { if (localStorage.getItem(`juple.tour.mainOnboarding.v1.${account.homeAccountId}`)) return; } catch { /* The server new-account boundary still prevents later launches. */ }
    const timer = window.setTimeout(() => {
      autoStarted.current = true;
      try { localStorage.setItem(`juple.tour.mainOnboarding.v1.${account.homeAccountId}`, 'started'); } catch { /* Storage is optional. */ }
      start('mainOnboarding');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isNewAccount, account.homeAccountId, start]);

  // The tour ends: focus goes back to what had it (the guide's button in Help), unless that is gone.
  const close = useCallback((completed = false) => {
    try { if (running?.guide.id === 'mainOnboarding') localStorage.setItem(`juple.tour.mainOnboarding.v1.${account.homeAccountId}`, completed ? 'completed' : 'skipped'); } catch { /* Storage is optional. */ }
    setRunning(null);
    const previous = returnFocusTo.current;
    returnFocusTo.current = null;
    if (previous instanceof HTMLElement) {
      window.setTimeout(() => {
        if (previous.isConnected) {
          previous.focus();
        }
      }, 0);
    }
  }, [account.homeAccountId, running]);

  const value = useMemo<TourContextValue>(() => ({ start, isRunning: running !== null }), [running, start]);
  return (
    <TourContext.Provider value={value}>
      {children}
      {running ? (
        <TourStepView
          guide={running.guide}
          index={running.index}
          key={`${running.guide.id}:${running.index}`}
          onClose={() => close()}
          onComplete={() => close(true)}
          onIndex={index => setRunning(current => (current ? { ...current, index } : current))}
        />
      ) : null}
    </TourContext.Provider>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function TourStepView({ guide, index, onIndex, onClose, onComplete }: { readonly guide: TourGuide; readonly index: number; readonly onIndex: (index: number) => void; readonly onClose: () => void; readonly onComplete: () => void }) {
  const { dictionary } = useSignedInApp();
  const router = useRouter();
  const pathname = usePathname();
  const step = guide.steps[index];
  const total = guide.steps.length;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  // The target's own corner radius (px), read from its computed style; null = not readable (the spotlight keeps its default).
  const [targetRadius, setTargetRadius] = useState<number | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [cardSize, setCardSize] = useState<Size | null>(null);

  // Going to the step's page when the person is somewhere else (a route change between steps). Only entering the step navigates;
  // someone who walks away mid-tour is not dragged back by a later pathname change.
  const routePath = step.route;
  const onRightPage = isOnRoute(pathname, routePath);
  const needsNavigation = !isOnRoute(pathname, routePath);
  const navigated = useRef(false);
  useEffect(() => {
    if (routePath && needsNavigation && !navigated.current) {
      navigated.current = true;
      router.push(routePath);
    }
  }, [needsNavigation, routePath, router]);

  // Finding the target: wait for it to render (a fresh page), up to a timeout; then explain without a spotlight instead of failing.
  const targetId = step.targetId;
  useEffect(() => {
    if (!targetId || !onRightPage) {
      return undefined;
    }
    const startedAt = Date.now();
    let target: Element | null = null;
    let scrolled = false;
    const measure = () => {
      if (!target || !target.isConnected) {
        target = findTourTarget(document, targetId);
      }
      if (target && !scrolled) {
        scrolled = true;
        target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' });
      }
      const box = target ? target.getBoundingClientRect() : null;
      const next = box && box.width > 0 && box.height > 0 ? { x: box.left, y: box.top, width: box.width, height: box.height } : null;
      if (next === null && Date.now() - startedAt >= TOUR_FIND_TIMEOUT_MS) {
        setMissing(true);
      }
      setRect(current => (sameRect(current, next) ? current : next));
      setTargetRadius(next && target ? parseCornerRadius(window.getComputedStyle(target).borderTopLeftRadius, next) : null);
    };
    // Resize, scroll (any container) and layout changes (a sidebar collapsing, a list loading) all move the target.
    const timer = window.setInterval(measure, TOUR_FIND_INTERVAL_MS);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [targetId, onRightPage]);

  useLayoutEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const { title, body } = tourStepText(dictionary, step.key);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card) {
      const box = card.getBoundingClientRect();
      setCardSize(current => (current && Math.abs(current.width - box.width) < 1 && Math.abs(current.height - box.height) < 1 ? current : { width: box.width, height: box.height }));
    }
  }, [title, body, viewport.width, viewport.height, isFirst, isLast]);

  // Focus goes into the card on each step (the Next button).
  useEffect(() => {
    nextRef.current?.focus();
  }, []);

  const spotlight = rect && viewport.width > 0 ? spotlightFor(rect, viewport) : null;
  const waiting = targetId !== undefined && rect === null && !missing;
  const placement = cardSize && viewport.width > 0 ? placeCard(spotlight, viewport, cardSize) : null;
  const progress = formatMessage(dictionary.tourProgress, { current: index + 1, total });
  const reduceMotion = prefersReducedMotion();

  const goNext = () => (isLast ? onComplete() : onIndex(index + 1));
  const goPrevious = () => onIndex(Math.max(0, index - 1));

  // Escape ends the tour and the arrows move through it wherever the focus is (the page behind is blocked, so a click may have left
  // the card); a ref keeps the listener on the current closures.
  const keysRef = useRef({ goNext, goPrevious, isFirst, onClose });
  useEffect(() => {
    keysRef.current = { goNext, goPrevious, isFirst, onClose };
  });
  useEffect(() => {
    const onDocumentKey = (event: globalThis.KeyboardEvent) => {
      const keys = keysRef.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        keys.onClose();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        keys.goNext();
      } else if (event.key === 'ArrowLeft' && !keys.isFirst) {
        event.preventDefault();
        keys.goPrevious();
      }
    };
    document.addEventListener('keydown', onDocumentKey);
    return () => document.removeEventListener('keydown', onDocumentKey);
  }, []);

  // Tab stays inside the card while the tour is open.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
    if (focusable && focusable.length > 0) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const cardStyle = placement ? { left: placement.left, top: placement.top } : { left: 0, top: 0 };

  return (
    <div className={styles.tourRoot} data-tour-overlay onKeyDown={onKeyDown}>
      {/* Blocks the page behind the tour; the spotlight is a hole in the dimming drawn by the ring's own shadow. */}
      <div aria-hidden className={spotlight ? styles.tourBlocker : styles.tourScrim} data-tour-scrim />
      {spotlight ? (
        <div
          aria-hidden
          className={reduceMotion ? styles.tourSpotlightStatic : styles.tourSpotlight}
          data-tour-spotlight
          style={{ borderRadius: spotlightRadius(targetRadius, spotlight) ?? undefined, height: spotlight.height, left: spotlight.x, top: spotlight.y, width: spotlight.width }}
        />
      ) : null}
      <div
        aria-describedby="tour-body"
        aria-labelledby="tour-title"
        aria-modal="true"
        className={reduceMotion ? styles.tourCardStatic : styles.tourCard}
        data-tour-card
        data-tour-side={placement?.side ?? 'center'}
        ref={cardRef}
        role="dialog"
        style={{ ...cardStyle, visibility: placement && !waiting ? 'visible' : 'hidden' }}
      >
        <p className={styles.tourProgress} data-tour-progress>
          {progress}
        </p>
        <h2 className={styles.tourTitle} id="tour-title">
          {title}
        </h2>
        <p className={styles.tourBody} id="tour-body">
          {body}
        </p>
        <div className={styles.tourActions}>
          <button className={styles.tourSkip} data-tour-skip onClick={onClose} type="button">
            {dictionary.tourSkip}
          </button>
          <span className={styles.tourNav}>
            {isFirst ? null : (
              <button className={styles.settingsAction} data-tour-previous onClick={goPrevious} type="button">
                {dictionary.tourPrevious}
              </button>
            )}
            <button className={styles.primaryAction} data-tour-next onClick={goNext} ref={nextRef} type="button">
              {isLast ? dictionary.tourDone : dictionary.tourNext}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
