import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, ScrollView, Text, useWindowDimensions } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useNoticeModalBlocked } from '../components/AppNativeModal';
import { navigationRef } from '../navigation/navigationRef';
import { subscribeSocialPushEvents } from '../push/pushEvents';
import { colors, spacing, themedStyles } from '../theme/tokens';
import { ModerationNoticeDetails, moderationNoticeIntro } from './ModerationNoticeBody';
import { acknowledgeModerationNotice, getModerationNotice, listUnacknowledgedModerationNotices, type ModerationNotice } from './moderationNoticeApi';

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
  const { height: windowHeight } = useWindowDimensions();
  const request = useAuthenticatedApi();
  const requestRef = useRef(request);
  requestRef.current = request;
  const [queue, setQueue] = useState<readonly ModerationNotice[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const blocked = useNoticeModalBlocked();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [route, setRoute] = useState(() => navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined);
  // Shown (or skipped) in this run: never offered twice, whatever the next read says.
  const handledRef = useRef(new Set<number>());
  const lastReadAtRef = useRef(0);
  const readingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const activeRef = useRef(true);
  const savingRef = useRef(false);
  const fetchingIdsRef = useRef(new Set<number>());

  const receive = useCallback(async (noticeId: number) => {
    if (handledRef.current.has(noticeId) || fetchingIdsRef.current.has(noticeId)) return;
    fetchingIdsRef.current.add(noticeId);
    try {
      // Never display text from a push: this recipient-scoped lookup validates ownership and returns the existing popup's full snapshot.
      // Fetch the specific new notice even when the oldest-first unacknowledged list already has a full page.
      const notice = await getModerationNotice(requestRef.current, noticeId);
      if (activeRef.current && notice && notice.kind !== 'reportResult' && notice.acknowledgedAtUtc === null && !handledRef.current.has(notice.id)) {
        setQueue(previous => previous.some(entry => entry.id === notice.id) ? previous : [...previous, notice]);
      }
    } catch {
      // No unsafe payload fallback. The original Inbox and the next foreground read remain available.
    } finally {
      fetchingIdsRef.current.delete(noticeId);
    }
  }, []);

  const refresh = useCallback(async (force: boolean) => {
    const now = Date.now();
    if (readingRef.current) {
      // A new push can arrive while the launch read still holds an older DB snapshot. Do one coalesced follow-up.
      pendingRefreshRef.current ||= force;
      return;
    }
    if (!force && now - lastReadAtRef.current < FOREGROUND_REFRESH_MS) {
      return;
    }
    readingRef.current = true;
    lastReadAtRef.current = now;
    try {
      do {
        pendingRefreshRef.current = false;
        const fresh = await listUnacknowledgedModerationNotices(requestRef.current);
        if (!activeRef.current) return;
        setQueue(current => {
          const known = new Set(current.map(notice => notice.id));
          const added = fresh.filter(notice => notice.kind !== 'reportResult' && notice.acknowledgedAtUtc === null && !handledRef.current.has(notice.id) && !known.has(notice.id));
          return added.length === 0 ? current : [...current, ...added];
        });
      } while (activeRef.current && pendingRefreshRef.current);
    } catch {
      // Quietly: the Inbox still holds every message; the next start or return asks again.
    } finally {
      readingRef.current = false;
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    refresh(true).catch(() => undefined);
    const appState = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state === 'active') {
        refresh(false).catch(() => undefined);
      }
    });
    const push = subscribeSocialPushEvents(event => {
      if (event.type === 'adminWarning') {
        if (event.noticeId) receive(event.noticeId).catch(() => undefined);
        else refresh(true).catch(() => undefined);
      }
    });
    return () => {
      activeRef.current = false;
      appState.remove();
      push();
    };
  }, [receive, refresh]);

  useEffect(() => navigationRef.addListener('state', () => {
    setRoute(navigationRef.getCurrentRoute());
  }), []);

  // A tap already opened the same notice: do not re-present it automatically when that screen closes.
  const routeNoticeId = route?.name === 'ModerationNotice' ? (route.params as { noticeId?: number } | undefined)?.noticeId : undefined;
  useEffect(() => {
    if (routeNoticeId !== undefined) {
      handledRef.current.add(routeNoticeId);
      setQueue(previous => previous.filter(notice => notice.id !== routeNoticeId));
    }
  }, [routeNoticeId]);

  // The one in front, unless the person is already reading exactly that message.
  const current = queue.find(notice => !handledRef.current.has(notice.id)) ?? null;
  const reading = current !== null
    && routeNoticeId === current.id;

  const confirm = async () => {
    if (current === null || savingRef.current) {
      return;
    }
    setIsSaving(true);
    savingRef.current = true;
    const notice = current;
    try {
      await acknowledgeModerationNotice(requestRef.current, notice.id);
    } catch {
      // Never a trap: not recorded now, so it is offered again at the next launch.
    } finally {
      savingRef.current = false;
      if (!activeRef.current) return;
      handledRef.current.add(notice.id);
      setQueue(previous => previous.filter(entry => entry.id !== notice.id));
      setIsSaving(false);
    }
  };

  // Native-stack sheets also own a presentation controller on iOS (they are not app Modal components).
  const nativeSheet = route?.name === 'ItemDetails' || route?.name === 'CollectionShare' || route?.name === 'Tutorial';
  if (current === null || reading || blocked || !foreground || nativeSheet) {
    return null;
  }

  const more = queue.filter(notice => !handledRef.current.has(notice.id)).length - 1;
  return (
    <ConfirmDialog
      blocksNotice={false}
      busy={isSaving}
      confirmLabel={t('moderation.acknowledge')}
      destructive={false}
      dismissable={false}
      message={moderationNoticeIntro(current, t)}
      onConfirm={() => { confirm().catch(() => undefined); }}
      title={t('moderation.teamTitle')}
      visible
    >
      {/* A long title or message scrolls here; the button stays on screen, however small the window. */}
      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: windowHeight * 0.5 }} testID="moderation-popup-scroll">
        <ModerationNoticeDetails compact notice={current} />
      </ScrollView>
      {more > 0 ? <Text style={styles.more} testID="moderation-popup-more">{t('moderation.moreCount', { count: more })}</Text> : null}
    </ConfirmDialog>
  );
}

const styles = themedStyles(() => ({
  more: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.sm },
}));
