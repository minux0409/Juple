import { useCallback, useRef } from 'react';
import type { HostInstance } from 'react-native';
import type { TourRect } from './tourPlacement';

/**
 * The screens' tour targets, by id. A screen marks an element with `useTourTarget('home.input')` and spreads the result onto a
 * View; the tour finds the element through this registry and never through the view tree, so renaming a style or moving the
 * element cannot silently break a guide. Ids are constants in tourGuides.ts.
 */
const targets = new Map<string, HostInstance>();
/** A marked element's own corner radius (optional): the spotlight ring follows it. React Native cannot read a style back from a view. */
const targetRadii = new Map<string, number>();
/**
 * A marked element's own spotlight padding (optional; default TOUR_SPOTLIGHT_PADDING): how far the ring stands off its edges. A
 * bottom tab declares 0 - the tab already fills its whole cell, and the default margin pushed the ring past the tab into its
 * neighbours and above the tab bar.
 */
const targetPaddings = new Map<string, number>();
const layoutListeners = new Map<string, Set<() => void>>();

/**
 * A marked element reports its own layout changes here (View onLayout), so the tour re-measures only when something actually moved
 * - it never polls. Returns the unsubscribe function.
 */
export function subscribeTourTargetLayout(id: string, listener: () => void): () => void {
  let set = layoutListeners.get(id);
  if (!set) {
    set = new Set();
    layoutListeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      layoutListeners.delete(id);
    }
  };
}

function notifyTourTargetLayout(id: string): void {
  layoutListeners.get(id)?.forEach(listener => listener());
}

export function registerTourTarget(id: string, node: HostInstance, radius?: number, padding?: number): void {
  targets.set(id, node);
  if (radius === undefined) {
    targetRadii.delete(id);
  } else {
    targetRadii.set(id, radius);
  }
  if (padding === undefined) {
    targetPaddings.delete(id);
  } else {
    targetPaddings.set(id, padding);
  }
}

/** The spotlight padding the target declared, or undefined (the tour then uses TOUR_SPOTLIGHT_PADDING). */
export function getTourTargetPadding(id: string): number | undefined {
  return targetPaddings.get(id);
}

/** The radius the target declared, or undefined (the tour then uses its default). */
export function getTourTargetRadius(id: string): number | undefined {
  return targetRadii.get(id);
}

export function unregisterTourTarget(id: string, node: HostInstance): void {
  if (targets.get(id) === node) {
    targets.delete(id);
    targetRadii.delete(id);
    targetPaddings.delete(id);
  }
}

/** The target's rectangle in WINDOW coordinates, or null when it is not on screen / cannot be measured. */
export function measureTourTarget(id: string): Promise<TourRect | null> {
  const node = targets.get(id);
  if (!node) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    try {
      node.measureInWindow((x, y, width, height) => {
        resolve(Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Props for the element to mark. `collapsable: false` keeps Android from flattening a layout-only view away (it could not be measured); `onLayout` tells the tour when the element moved or resized. */
export function useTourTarget(id: string, options: { readonly radius?: number; readonly padding?: number } = {}): { readonly ref: (node: HostInstance | null) => void; readonly collapsable: false; readonly onLayout: () => void } {
  const nodeRef = useRef<HostInstance | null>(null);
  const { radius, padding } = options;
  const ref = useCallback(
    (node: HostInstance | null) => {
      if (nodeRef.current) {
        unregisterTourTarget(id, nodeRef.current);
      }
      nodeRef.current = node;
      if (node) {
        registerTourTarget(id, node, radius, padding);
      }
    },
    [id, radius, padding],
  );
  const onLayout = useCallback(() => notifyTourTargetLayout(id), [id]);
  return { ref, collapsable: false, onLayout };
}
