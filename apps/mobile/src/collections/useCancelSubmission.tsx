import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, StyleSheet } from 'react-native';
import { ApiError } from '../api/ApiError';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { colors, minTouchTarget, radii } from '../theme/tokens';

const ACTION_ICON_SIZE = 22;

interface CancellableRow {
  readonly submissionId: number;
  readonly title: string | null;
  readonly url: string;
}

interface UseCancelSubmissionOptions {
  /** The one cancel call (member route or public-link route) for this row; rejects with ApiError. */
  readonly cancel: (row: CancellableRow) => Promise<void>;
  /** The row is no longer waiting (cancelled by me, or already answered): drop it and refresh counts. */
  readonly onGone: (row: CancellableRow) => void;
}

/**
 * The requester's icon actions for a pending proposal - ONE behavior for the popup (member) and the
 * public-link screen: [open the link] always visible, and cancel by swiping the card left. Opening only opens the URL
 * I submitted (the system browser) and changes nothing. Cancelling asks first (nothing changes unless it is
 * confirmed), has a row-level busy state (no repeated taps), and on failure the row stays with the common
 * message. "Already answered" (404 - approved, rejected or cancelled elsewhere) is not a failure: the row
 * simply leaves and the message says so.
 */
export function useCancelSubmission({ cancel, onGone }: UseCancelSubmissionOptions) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<CancellableRow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Synchronous guard: two taps in the same frame must not start two requests.
  const inFlightRef = useRef(false);

  const run = useCallback(async (row: CancellableRow) => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setBusyId(row.submissionId);
    try {
      await cancel(row);
      onGone(row);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
        onGone(row);
        setMessage(t('submissions.alreadyProcessed'));
      } else {
        setMessage(t('submissions.cancelFailed'));
      }
    } finally {
      inFlightRef.current = false;
      setBusyId(null);
    }
  }, [cancel, onGone, t]);

  // No canOpenURL pre-check (Android package visibility); a real failure surfaces through the catch. The URL is the
  // requester's own submitted link, so nothing else is revealed by opening it.
  const openLink = useCallback(async (row: CancellableRow) => {
    try {
      await Linking.openURL(row.url);
    } catch {
      setMessage(t('item.urlOpenFailed'));
    }
  }, [t]);

  /** The one always-visible action of a requester card: open my submitted link (a spinner instead while its cancel runs). */
  const renderOpenAction = (row: CancellableRow): ReactNode => {
    const title = row.title?.trim() ? row.title : row.url;
    return (
      <Pressable
        accessibilityLabel={`${t('trash.openLink')}: ${title}`}
        accessibilityRole="button"
        hitSlop={4}
        onPress={() => {
          // An open swipe row closes first, so nothing destructive stays armed while the link opens.
          closeOpenRow();
          openLink(row).catch(() => undefined);
        }}
        style={styles.iconButton}
        testID={`submission-open-${row.submissionId}`}
      >
        {busyId === row.submissionId
          ? <ActivityIndicator color={colors.textSecondary} size="small" />
          : <ExternalLinkIcon color={colors.textSecondary} size={ACTION_ICON_SIZE} />}
      </Pressable>
    );
  };

  /**
   * Swipe left on a requester card reveals the red cancel action (Juple's one destructive-swipe pattern -
   * SwipeableItemRow, with its horizontal-vs-vertical arbitration, one open row at a time). Revealing does
   * nothing by itself: tapping the revealed action only opens the confirmation. Swiping is off while any
   * cancel runs (single-flight).
   */
  const swipeToCancel = (row: CancellableRow, children: ReactNode): ReactNode => {
    const title = row.title?.trim() ? row.title : row.url;
    return (
      <SwipeableItemRow
        contentAccessible={false}
        containerStyle={styles.swipeFrame}
        deleteIconOnly
        deleteLabel={t('submissions.cancelRequestA11y', { title })}
        deleteTestID={`submission-cancel-${row.submissionId}`}
        disabled={busyId !== null}
        onDelete={() => setConfirming(row)}
      >
        {children}
      </SwipeableItemRow>
    );
  };

  /** Render these inside the same Modal as the list (the sheet's modalExtras) - one native Modal at a time on iOS. */
  const dialogs = (
    <>
      <ConfirmDialog
        cancelLabel={t('submissions.keepRequest')}
        confirmLabel={t('submissions.cancelRequest')}
        message={t('submissions.cancelRequestConfirmMessage')}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const row = confirming;
          setConfirming(null);
          if (row) {
            run(row).catch(() => undefined);
          }
        }}
        title={t('submissions.cancelRequestConfirm')}
        visible={confirming !== null}
      />
      <ConfirmDialog
        confirmLabel={t('common.confirm')}
        destructive={false}
        message={message ?? ''}
        onConfirm={() => setMessage(null)}
        title={t('common.notice')}
        visible={message !== null}
      />
    </>
  );

  return { renderOpenAction, swipeToCancel, openLink, dialogs, busyId } as const;
}

const styles = StyleSheet.create({
  // The card's own frame (radius) clips the revealed red action; the card inside keeps its approved geometry.
  // The row's whole outer shape: rounded corners, the card's hairline border and its surface, clipped together
  // (SwipeableItemRow keeps overflow hidden) - the embedded card inside draws no border/radius of its own.
  swipeFrame: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  // Icon-only, a full 44dp touch target each; the red of the trash is the only emphasis (no filled or outlined box).
  iconButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
});
