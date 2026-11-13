'use client';

import { createContext, useContext, useEffect } from 'react';

/**
 * Lets a view that holds unsaved edits tell the frame around it (the Quick Detail sheet) that closing now would lose them, so the frame
 * asks first. A view outside such a frame (the standalone page) simply has no guard: the browser's own beforeunload question covers it.
 */
export const LeaveGuardContext = createContext<((dirty: boolean) => void) | null>(null);

export function useLeaveGuard(dirty: boolean): void {
  const setDirty = useContext(LeaveGuardContext);
  useEffect(() => {
    setDirty?.(dirty);
    return () => setDirty?.(false);
  }, [dirty, setDirty]);
}
