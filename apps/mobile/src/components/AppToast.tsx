import { useCallback, useContext, useRef, useState, createContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { NotificationToast } from './NotificationToast';
import { UndoToast } from './UndoToast';
import { ConfirmDialog } from './ConfirmDialog';

type Toast =
  | { readonly id: number; readonly kind: 'notification'; readonly message: string }
  | { readonly id: number; readonly kind: 'undo'; readonly message: string; readonly actionLabel: string; readonly onUndo: () => Promise<void>; readonly undoErrorMessage?: string; readonly noticeTitle: string; readonly confirmLabel: string };

/** Captured at the moment undo fails, since `toast` itself is cleared in the same batched update
 * that sets this - reading `toast.noticeTitle`/`confirmLabel` from render at that point would see
 * `toast` already null. */
type UndoFailure = { readonly message: string; readonly noticeTitle: string; readonly confirmLabel: string };

type AppToastContextValue = {
  readonly showNotificationToast: (message: string) => void;
  readonly showUndoToast: (toast: Omit<Extract<Toast, { kind: 'undo' }>, 'id' | 'kind'>) => void;
  readonly dismissToast: () => void;
  /**
   * `owner` is a caller-chosen id (see useToastBottomAnchor.ts, the only intended caller) that
   * must be passed back to clearToastBottomOffset unchanged. A plain "focus: set, blur: clear"
   * pair isn't safe on its own - React Navigation doesn't guarantee the outgoing screen's blur
   * cleanup runs before the incoming screen's focus effect, so a stale screen's cleanup could
   * otherwise clobber whichever screen registered after it. clearToastBottomOffset only takes
   * effect while `owner` is still the most recent registrant.
   */
  readonly setToastBottomOffset: (owner: number, bottomOffset: number) => void;
  readonly clearToastBottomOffset: (owner: number) => void;
};

const missingProvider: AppToastContextValue = {
  showNotificationToast: () => undefined,
  showUndoToast: () => undefined,
  dismissToast: () => undefined,
  setToastBottomOffset: () => undefined,
  clearToastBottomOffset: () => undefined,
};
const AppToastContext = createContext<AppToastContextValue>(missingProvider);

export function AppToastProvider({ children }: { readonly children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);
  const bottomOffsetOwnerRef = useRef<number | null>(null);
  const nextIdRef = useRef(0);
  const isUndoingRef = useRef(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoFailure, setUndoFailure] = useState<UndoFailure | null>(null);

  const dismissToast = useCallback(() => {
    isUndoingRef.current = false;
    setIsUndoing(false);
    setToast(null);
  }, []);
  const showNotificationToast = useCallback((message: string) => {
    isUndoingRef.current = false;
    setIsUndoing(false);
    setToast({ id: ++nextIdRef.current, kind: 'notification', message });
  }, []);
  const showUndoToast = useCallback((next: Omit<Extract<Toast, { kind: 'undo' }>, 'id' | 'kind'>) => {
    isUndoingRef.current = false;
    setIsUndoing(false);
    setToast({ ...next, id: ++nextIdRef.current, kind: 'undo' });
  }, []);
  const undo = useCallback(async () => {
    if (toast?.kind !== 'undo' || isUndoingRef.current) return;
    const undoToast = toast;
    isUndoingRef.current = true;
    setIsUndoing(true);
    try {
      await undoToast.onUndo();
    } catch {
      if (undoToast.undoErrorMessage) {
        setUndoFailure({ message: undoToast.undoErrorMessage, noticeTitle: undoToast.noticeTitle, confirmLabel: undoToast.confirmLabel });
      }
    } finally {
      isUndoingRef.current = false;
      setIsUndoing(false);
      setToast(current => current?.id === undoToast.id ? null : current);
    }
  }, [toast]);
  // Identity must stay stable across every Provider re-render that isn't a new/dismissed toast
  // (bottomOffset/isUndoing/undoFailure all change independently via unrelated state) -
  // UndoToast/NotificationToast key their own auto-dismiss timer's effect off this prop's
  // identity, so an inline arrow here would restart that timer on every unrelated re-render
  // (e.g. an anchor change from screen focus, or isUndoing flipping mid-undo).
  const handleDismiss = useCallback(() => setToast(null), []);
  const handleUndo = useCallback(() => { void undo(); }, [undo]);

  const setToastBottomOffset = useCallback((owner: number, value: number) => {
    bottomOffsetOwnerRef.current = owner;
    setBottomOffset(value);
  }, []);
  const clearToastBottomOffset = useCallback((owner: number) => {
    // Only releases ownership tracking - never resets bottomOffset itself, so a screen's own
    // blur can never yank a still-visible Toast back to some default position; whichever screen
    // focuses next (if any) will register its own correct value before any new Toast could show.
    if (bottomOffsetOwnerRef.current === owner) {
      bottomOffsetOwnerRef.current = null;
    }
  }, []);

  return <AppToastContext.Provider value={{ showNotificationToast, showUndoToast, dismissToast, setToastBottomOffset, clearToastBottomOffset }}>
    <View style={styles.container}>{children}</View>
    {toast?.kind === 'notification' ? <NotificationToast key={toast.id} bottomOffset={bottomOffset} message={toast.message} onDismiss={handleDismiss} /> : null}
    {toast?.kind === 'undo' ? <UndoToast key={toast.id} actionLabel={toast.actionLabel} bottomOffset={bottomOffset} isUndoing={isUndoing} message={toast.message} onDismiss={handleDismiss} onUndo={handleUndo} /> : null}
    {undoFailure ? <ConfirmDialog confirmLabel={undoFailure.confirmLabel} message={undoFailure.message} onConfirm={() => setUndoFailure(null)} title={undoFailure.noticeTitle} visible /> : null}
  </AppToastContext.Provider>;
}

export function useAppToast(): AppToastContextValue {
  return useContext(AppToastContext);
}

const styles = StyleSheet.create({ container: { flex: 1 } });
