import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutAnimation, Platform, ScrollView, Text, UIManager, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { BOTTOM_SHEET_MAX_WIDTH, BottomSheetModal } from '../components/BottomSheetModal';
import { PendingActionRow } from '../components/PendingActionRow';
import { Pressable } from '../components/Pressable';
import { useReduceMotion } from '../components/useReduceMotion';
import { BackArrowIcon } from '../icons/BackArrowIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';
import { useApprovalSubmissionSheetParts } from './ApprovalSubmissionSheet';
import { useJoinRequestsSheetParts } from './JoinRequestsSheet';

/** One slide between the type chooser and a list: ~250ms, easing out (decelerating into place). */
export const REVIEW_SHEET_SLIDE_MS = 250;

export type ReviewSheetPage = 'types' | 'approvals' | 'join';

interface Props {
  readonly visible: boolean;
  /** The page the sheet opens on: the type chooser, or straight to one list (a notification that names it). */
  readonly initialPage?: ReviewSheetPage;
  readonly collectionId: number;
  readonly authenticatedRequest: AuthenticatedApiRequest;
  readonly approvalCount: number;
  readonly joinCount: number;
  /** Closes the sheet - and ONLY the sheet: nothing here ever answers, cancels or approves a request. */
  readonly onClose: () => void;
  /** A request was answered: the Collection refreshes its counts and badge. */
  readonly onChanged: () => void;
  /**
   * A list of a locked Collection first asks for the password (the Collection's own gate): `open` runs once it is unlocked. Default: runs
   * at once.
   */
  readonly onBeforeOpenList?: (open: () => void) => void;
}

/**
 * 검토할 요청: ONE bottom sheet with inner pages. It opens from below like every sheet; choosing 링크 승인 요청 or 참여 요청 slides the list in
 * from the end side INSIDE the same sheet (no second sheet is raised) and back slides it out the other way, the sheet's height following the
 * page (a layout animation). The header shows the page's title with a back arrow on a list; the X, the backdrop and a downward drag only
 * close the sheet, and the system back button first steps from a list to the chooser. The two lists are exactly the 승인 대기 / 참여 요청
 * sheets' own (same loading, cards, confirmations and APIs) - only their shell is shared.
 */
export function CollectionReviewRequestsSheet({ visible, initialPage = 'types', collectionId, authenticatedRequest, approvalCount, joinCount, onClose, onChanged, onBeforeOpenList }: Props) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const { width: windowWidth } = useWindowDimensions();
  const [page, setPage] = useState<ReviewSheetPage>(initialPage);
  const [leaving, setLeaving] = useState<{ readonly page: ReviewSheetPage; readonly direction: 1 | -1 } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(Math.min(windowWidth, BOTTOM_SHEET_MAX_WIDTH));
  const progress = useRef(new Animated.Value(1)).current;
  const directionRef = useRef<1 | -1>(1);
  const pageRef = useRef(page);
  pageRef.current = page;
  const holdPageRef = useRef(false);

  // A fresh opening starts on the requested page (but not when a list was just chosen behind a password prompt and the sheet is coming back).
  useEffect(() => {
    if (visible) {
      if (holdPageRef.current) {
        holdPageRef.current = false;
      } else {
        setPage(initialPage);
        setLeaving(null);
        progress.setValue(1);
      }
    }
    // Only the opening matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  const slideTo = (next: ReviewSheetPage) => {
    const from = pageRef.current;
    if (from === next) {
      return;
    }
    const direction: 1 | -1 = next === 'types' ? -1 : 1;
    directionRef.current = direction;
    if (reduceMotion) {
      setPage(next);
      return;
    }
    // The sheet's height follows the page it shows.
    LayoutAnimation.configureNext(LayoutAnimation.create(REVIEW_SHEET_SLIDE_MS, LayoutAnimation.Types.easeOut, LayoutAnimation.Properties.opacity));
    setLeaving({ page: from, direction });
    setPage(next);
    progress.setValue(0);
    Animated.timing(progress, { duration: REVIEW_SHEET_SLIDE_MS, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }).start(({ finished }) => {
      if (finished) {
        setLeaving(null);
      }
    });
  };

  const openList = (target: 'approvals' | 'join') => {
    const run = () => {
      holdPageRef.current = false;
      slideTo(target);
    };
    if (onBeforeOpenList) {
      // The sheet may step aside for a password prompt and return; it must come back on this list.
      holdPageRef.current = true;
      onBeforeOpenList(() => {
        run();
      });
    } else {
      run();
    }
  };

  const goBack = () => slideTo('types');
  // A list whose last request was just answered returns to the chooser while the other kind still waits; otherwise the sheet is done.
  const finishList = () => {
    const otherWaiting = pageRef.current === 'approvals' ? joinCount : approvalCount;
    if (otherWaiting > 0) {
      goBack();
    } else {
      onClose();
    }
  };

  const showsApprovals = visible && (page === 'approvals' || leaving?.page === 'approvals');
  const showsJoin = visible && (page === 'join' || leaving?.page === 'join');
  const approvals = useApprovalSubmissionSheetParts({ authenticatedRequest, collectionId, expectedCount: approvalCount, onChanged, onClose: finishList, variant: 'owner', visible: showsApprovals });
  const join = useJoinRequestsSheetParts({ authenticatedRequest, collectionId, expectedCount: joinCount, onChanged, onClose: finishList, visible: showsJoin });

  const renderRequest = (label: string, count: number, target: 'approvals' | 'join', testID: string) => count > 0 ? (
    <PendingActionRow
      accessibilityLabel={label + ', ' + t('collections.myPendingStatus', { count })}
      compact
      count={count}
      label={label}
      onPress={() => openList(target)}
      testID={testID}
    />
  ) : null;

  const typesContent = (
    <ScrollView contentContainerStyle={styles.rows} testID="collection-review-types">
      {renderRequest(t('collections.pendingSubmissions'), approvalCount, 'approvals', 'collection-review-approvals')}
      {renderRequest(t('collections.joinRequests'), joinCount, 'join', 'collection-review-join')}
      {approvalCount + joinCount === 0 ? <Text style={styles.empty}>{t('submissions.empty')}</Text> : null}
    </ScrollView>
  );
  const nodeOf = (target: ReviewSheetPage) => (target === 'approvals' ? approvals.content : target === 'join' ? join.content : typesContent);

  const title = page === 'approvals' ? approvals.title : page === 'join' ? join.title : t('collections.reviewRequests');
  const titleTestID = page === 'join' ? join.titleTestID ?? undefined : undefined;
  const slide = (from: number, to: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

  return (
    <BottomSheetModal
      headerActions={
        <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" hitSlop={4} onPress={onClose} style={styles.close} testID="collection-review-close">
          <CloseIcon color={colors.textSecondary} size={20} />
        </Pressable>
      }
      headerTitle={
        <View style={styles.titleRow}>
          {page !== 'types' ? (
            <Pressable accessibilityLabel={t('common.back')} accessibilityRole="button" hitSlop={4} onPress={goBack} style={styles.back} testID="collection-review-back">
              <BackArrowIcon color={colors.textPrimary} size={20} />
            </Pressable>
          ) : null}
          <Text accessibilityRole="header" style={styles.title} testID={titleTestID ?? 'collection-review-title'}>{title}</Text>
        </View>
      }
      modalExtras={<>{approvals.modalExtras}{join.modalExtras}</>}
      onBack={page === 'types' ? undefined : goBack}
      onClose={onClose}
      testID="collection-review-requests-sheet"
      visible={visible}
    >
      <View onLayout={event => setViewportWidth(event.nativeEvent.layout.width)} style={styles.viewport}>
        {leaving ? (
          <Animated.View pointerEvents="none" style={[styles.leaving, { transform: [{ translateX: slide(0, -leaving.direction * viewportWidth) }] }]}>
            {nodeOf(leaving.page)}
          </Animated.View>
        ) : null}
        <Animated.View style={leaving ? { transform: [{ translateX: slide(leaving.direction * viewportWidth, 0) }] } : undefined} testID={`collection-review-page-${page}`}>
          {nodeOf(page)}
        </Animated.View>
      </View>
    </BottomSheetModal>
  );
}

const styles = themedStyles(() => ({
  close: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  back: { alignItems: 'center', justifyContent: 'center', marginStart: -spacing.sm, minHeight: minTouchTarget, minWidth: minTouchTarget },
  titleRow: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 18, fontWeight: '700' },
  // Clips the sliding pages to the sheet's own width.
  viewport: { overflow: 'hidden' },
  leaving: { left: 0, position: 'absolute', right: 0, top: 0 },
  rows: { gap: spacing.sm },
  empty: { color: colors.textSecondary },
}));
