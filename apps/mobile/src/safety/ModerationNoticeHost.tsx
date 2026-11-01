import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Text } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { navigationRef } from '../navigation/navigationRef';
import { subscribeSocialPushEvents } from '../push/pushEvents';
import { colors, spacing, themedStyles } from '../theme/tokens';
import { ModerationNoticeDetails, moderationNoticeIntro } from './ModerationNoticeBody';
import { acknowledgeModerationNotice, listUnacknowledgedModerationNotices, type ModerationNotice } from './moderationNoticeApi';

/** At most one read per this long when the app only returns to the foreground. */
const FOREGROUND_REFRESH_MS = 30_000;

/**
 * 운영팀 안내 pop-up: the operator messages (a warning, or an action on the person's link / Collection / account) the person has not confirmed
 * yet are shown ONCE, one after another, when the app starts, comes back to the foreground, a push about one arrives while the app is open, or
 * right after sign-in. Confirming ("확인") only records that it was read (the notice stays in the Inbox and can be opened again); a failure to
 * record it never traps the person - the message is skipped until the next launch. A notice is never shown again in the same run, and not while
 * its own screen is open. The server decides what is unconfirmed; this only presents it.
 */
export function ModerationNoticeHost() {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const requestRef = useRef(request);
  requestRef.current = request;
  const [queue, setQueue] = useState<readonly ModerationNotice[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  // Shown (or skipped) in this run: never offered twice, whatever the next read says.
  const handledRef = useRef(new Set<number>());
  const lastReadAtRef = useRef(0);
  const readingRef = useRef(false);

  const refresh = useCallback(async (force: boolean) => {
    const now = Date.now();
    if (readingRef.current || (!force && now - lastReadAtRef.current < FOREGROUND_REFRESH_MS)) {
      return;
    }
    readingRef.current = true;
    lastReadAtRef.current = now;
    try {
      const fresh = await listUnacknowledgedModerationNotices(requestRef.current);
      setQueue(current => {
        const known = new Set(current.map(notice => notice.id));
        const added = fresh.filter(notice => !handledRef.current.has(notice.id) && !known.has(notice.id));
        return added.length === 0 ? current : [...current, ...added];
      });
    } catch {
      // Quietly: the Inbox still holds every message; the next start or return asks again.
    } finally {
      readingRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh(true).catch(() => undefined);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh(false).catch(() => undefined);
      }
    });
    const push = subscribeSocialPushEvents(event => {
      if (event.type === 'adminWarning') {
        refresh(true).catch(() => undefined);
      }
    });
    return () => {
      appState.remove();
      push();
    };
  }, [refresh]);

  // The one in front, unless the person is already reading exactly that message.
  const current = queue.find(notice => !handledRef.current.has(notice.id)) ?? null;
  const reading = current !== null
    && navigationRef.isReady()
    && navigationRef.getCurrentRoute()?.name === 'ModerationNotice'
    && (navigationRef.getCurrentRoute()?.params as { noticeId?: number } | undefined)?.noticeId === current.id;

  const confirm = async () => {
    if (current === null || isSaving) {
      return;
    }
    setIsSaving(true);
    const notice = current;
    try {
      await acknowledgeModerationNotice(requestRef.current, notice.id);
    } catch {
      // Never a trap: not recorded now, so it is offered again at the next launch.
    } finally {
      handledRef.current.add(notice.id);
      setQueue(previous => previous.filter(entry => entry.id !== notice.id));
      setIsSaving(false);
    }
  };

  if (current === null || reading) {
    return null;
  }

  const more = queue.filter(notice => !handledRef.current.has(notice.id)).length - 1;
  return (
    <ConfirmDialog
      busy={isSaving}
      confirmLabel={t('common.confirm')}
      destructive={false}
      dismissable={false}
      message={moderationNoticeIntro(current, t)}
      onConfirm={() => { confirm().catch(() => undefined); }}
      title={t('moderation.teamTitle')}
      visible
    >
      <ModerationNoticeDetails compact notice={current} />
      {more > 0 ? <Text style={styles.more} testID="moderation-popup-more">{t('moderation.moreCount', { count: more })}</Text> : null}
    </ConfirmDialog>
  );
}

const styles = themedStyles(() => ({
  more: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.sm },
}));
