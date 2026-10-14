import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { itemRestorePath, moveUndoPath } from '../lib/collectionOperations.ts';
import {
  beginUndo,
  dismiss,
  expire,
  failUndo,
  finishUndo,
  NOTICE_TOAST_DURATION_MS,
  showNotice,
  showUndo,
  timeoutOf,
  UNDO_TOAST_DURATION_MS,
} from '../lib/undoToast.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('undo snackbar rules', () => {
  it('mobile timing: an offer stays 5 seconds, then closes and the action stays done', () => {
    assert.equal(UNDO_TOAST_DURATION_MS, 5000);
    const offer = showUndo(1, '삭제했습니다', '되돌리지 못했습니다');
    assert.equal(timeoutOf(offer), 5000);
    assert.equal(expire(offer, 1), null);
  });

  it('되돌리기 runs once: a second press while it runs does nothing', () => {
    const offer = showUndo(1, 'm', 'e');
    const first = beginUndo(offer, 1);
    assert.equal(first.start, true);
    const second = beginUndo(first.state, 1);
    assert.equal(second.start, false);
    assert.equal(timeoutOf(first.state), null, 'a running undo never times out underneath itself');
    assert.equal(expire(first.state, 1)?.kind, 'undo', 'the time running out does not cut a running undo off');
  });

  it('success closes it; failure says so, stays until closed, and is not pressable again', () => {
    const running = beginUndo(showUndo(3, 'm', 'e'), 3).state;
    assert.equal(finishUndo(running, 3), null);
    const failed = failUndo(running, 3);
    assert.equal(failed?.kind === 'undo' && failed.phase, 'failed');
    assert.equal(timeoutOf(failed), null);
    assert.equal(beginUndo(failed, 3).start, false);
    assert.equal(dismiss(failed, 3), null);
  });

  it('a newer toast replaces the older one and the older one can no longer be pressed or closed over it', () => {
    const older = showUndo(1, 'a', 'e');
    const newer = showUndo(2, 'b', 'e');
    assert.equal(beginUndo(newer, 1).start, false);
    assert.equal(finishUndo(newer, 1), newer);
    assert.equal(expire(newer, 1), newer);
    assert.equal(dismiss(newer, 1), newer);
    assert.equal(beginUndo(older, 1).start, true);
  });

  it('a notice has no action and closes by itself; an error notice stays a little longer', () => {
    assert.equal(timeoutOf(showNotice(1, 'x')), NOTICE_TOAST_DURATION_MS);
    assert.equal(timeoutOf(showNotice(1, 'x', 'error')), NOTICE_TOAST_DURATION_MS * 2);
    assert.equal(beginUndo(showNotice(1, 'x'), 1).start, false);
    assert.equal(timeoutOf(null), null);
  });

  it('the server reverses are the ones mobile calls', () => {
    assert.equal(itemRestorePath(42), '/api/v1/items/42/restore');
    assert.equal(moveUndoPath(7, 42), '/api/v1/collections/7/items/42/move/undo');
  });

  it('the link details offer 되돌리기 for delete, remove-from-collection and the atomic move - through the one shared snackbar', () => {
    const detail = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(detail, /toast\.showUndo\(/);
    assert.match(detail, /dictionary\.toastDeleted/);
    assert.match(detail, /dictionary\.toastRemovedFromCollection/);
    assert.match(detail, /dictionary\.toastMoved/);
    assert.match(detail, /itemRestorePath\(itemId\)/);
    assert.match(detail, /moveUndoPath\(sourceId, itemId\)/);
    // The sheet closes right after the action; the snackbar lives above it (the app-wide provider), so it is not unmounted with it.
    const root = source('app/(app)/AppRoot.tsx');
    assert.match(root, /<ToastProvider>\s*<AppShell>/);
  });

  it('the snackbar is a polite status (an error is an alert) with a real button, never colour alone', () => {
    const toaster = source('app/(app)/Toaster.tsx');
    assert.match(toaster, /role=\{isError \? 'alert' : 'status'\}/);
    assert.match(toaster, /<button className=\{styles\.toastAction\}/);
    assert.match(toaster, /disabled=\{toast\.phase === 'undoing'\}/);
  });
});
