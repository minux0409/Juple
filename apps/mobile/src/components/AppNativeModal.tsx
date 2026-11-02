import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Modal, Platform, type ModalProps } from 'react-native';

const blockers = new Set<object>();
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => blockers.size > 0;

/** Operator notices wait behind app-owned dialogs/editors. The notice itself never blocks its own presentation. */
export function useNoticeModalBlocked(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Tracks presentation through iOS's actual dismissal, without changing any existing modal's visibility or callbacks. */
export function AppNativeModal({ blocksNotice = true, onDismiss, visible, ...props }: ModalProps & { readonly blocksNotice?: boolean }) {
  const key = useRef({}).current;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const release = useCallback(() => { if (blockers.delete(key)) emit(); }, [key]);
  useLayoutEffect(() => {
    if (visible && blocksNotice) {
      if (!blockers.has(key)) { blockers.add(key); emit(); }
    } else if (Platform.OS !== 'ios' || !blocksNotice) {
      release();
    }
  }, [visible, blocksNotice, key, release]);
  useLayoutEffect(() => release, [release]);
  return <Modal {...props} visible={visible} onDismiss={() => { if (!visibleRef.current) release(); onDismiss?.(); }} />;
}
