import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { lookupJupleId, type JupleIdLookupResult } from '../collections/api/collaborationApi';
import { AppModal } from '../components/AppModal';
import { SearchIconButton } from '../components/SearchIconButton';
import { UserAvatar } from '../components/UserAvatar';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { sendFriendRequest, type Friend, type FriendRequest } from './api/friendsApi';
import { atJupleId, friendPrimaryLabel, jupleIdForLookup } from './friendIdentity';

function getLookupErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return t('collaboration.lookupNotFound');
    }
    if (error.kind === 'tooManyRequests') {
      return t('collaboration.tooManyRequests');
    }
  }
  return t('collaboration.lookupFallback');
}

/** The server's own verdict that an accept/decline/cancel hit a request that is not open any more. */
export const FRIEND_REQUEST_NO_LONGER_PENDING = 'requestNoLongerPending';

/**
 * intent says what the caller was doing: answering someone else's request (accept/decline - the sender
 * most likely withdrew it) or cancelling their own (it was answered meanwhile). Only the server's
 * "no longer pending" code is read as that - a plain not-found is still "no such Juple ID".
 */
export function getFriendRequestErrorMessage(
  error: unknown,
  t: TFunction,
  intent: 'send' | 'answer' | 'cancel' = 'send',
): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound' && error.code === FRIEND_REQUEST_NO_LONGER_PENDING) {
      return intent === 'cancel' ? t('friends.requestNoLongerPending') : t('friends.requestCancelledByRequester');
    }
    if (error.kind === 'conflict') {
      switch (error.code) {
        case 'alreadyFriends':
          return t('friends.alreadyFriends');
        case 'requestPending':
          return t('friends.requestAlreadyPending');
        case 'incomingRequestExists':
          return t('friends.incomingRequestExists');
      }
    }
    if (error.kind === 'badRequest') {
      return t('friends.cannotAddSelf');
    }
    if (error.kind === 'notFound') {
      return t('collaboration.lookupNotFound');
    }
    if (error.kind === 'tooManyRequests') {
      return t('collaboration.tooManyRequests');
    }
  }
  return t('friends.actionFallback');
}

/**
 * What the found person is to me - only from what is actually known: the server says whether it is
 * me; the request list (loaded in full - the server caps it) says whether a request is waiting
 * either way; "already friends" only when they are in the friend list I have loaded. Anything
 * else is "available" - the server has the final word when the request is sent.
 */
export type FoundRelationship = 'self' | 'pending' | 'incoming' | 'friend' | 'available';

export function relationshipOf(
  found: JupleIdLookupResult,
  friends: readonly Friend[],
  requests: readonly FriendRequest[],
): FoundRelationship {
  if (found.isSelf) {
    return 'self';
  }
  if (requests.some(request => request.direction === 'outgoing' && request.jupleId === found.jupleId)) {
    return 'pending';
  }
  if (requests.some(request => request.direction === 'incoming' && request.jupleId === found.jupleId)) {
    return 'incoming';
  }
  if (friends.some(friend => friend.jupleId === found.jupleId)) {
    return 'friend';
  }
  return 'available';
}

interface AddFriendModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly friends: readonly Friend[];
  readonly requests: readonly FriendRequest[];
  /** The request just sent - the screen adds it to 보낸 요청 at once. */
  readonly onRequestSent: (request: FriendRequest) => void;
  /** The server knew better (already friends / already asked either way) - reload the lists. */
  readonly onStale: () => void;
  /** They already asked me - go to 받은 요청 to answer it. */
  readonly onShowIncoming: () => void;
}

/**
 * 친구 추가: an exact Juple ID lookup only (never an email, nickname or directory search), one
 * lookup per tap - then the person, and what can be done: send a request, or why not.
 */
export function AddFriendModal({ visible, onClose, friends, requests, onRequestSent, onStale, onShowIncoming }: AddFriendModalProps) {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [input, setInput] = useState('');
  const [found, setFound] = useState<JupleIdLookupResult | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setInput('');
      setFound(null);
      setMessage(null);
    }
  }, [visible]);

  const lookup = async () => {
    const jupleId = jupleIdForLookup(input);
    if (!jupleId || isLookingUp) {
      return;
    }
    setIsLookingUp(true);
    setMessage(null);
    setFound(null);
    try {
      setFound(await lookupJupleId(authenticatedRequest, jupleId));
    } catch (caughtError) {
      setMessage(getLookupErrorMessage(caughtError, t));
    } finally {
      setIsLookingUp(false);
    }
  };

  const send = async () => {
    if (!found || isSending) {
      return;
    }
    setIsSending(true);
    setMessage(null);
    try {
      // The result card then reads just "요청 대기 중" (the relationship) - no second sentence saying the same.
      onRequestSent(await sendFriendRequest(authenticatedRequest, found.jupleId));
    } catch (caughtError) {
      setMessage(getFriendRequestErrorMessage(caughtError, t));
      if (caughtError instanceof ApiError && caughtError.kind === 'conflict') {
        onStale();
      }
    } finally {
      setIsSending(false);
    }
  };

  const relationship = found ? relationshipOf(found, friends, requests) : null;
  const canLookUp = !!jupleIdForLookup(input) && !isLookingUp;

  return (
    <AppModal dismissible={!isSending} onClose={onClose} testID="friends-add-modal" title={t('friends.add')} visible={visible}>
      <Text style={styles.hint}>{t('friends.lookupHint')}</Text>
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel={t('friends.friendJupleIdPlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          // Room for "@", a hyphen and stray spaces around the 8 characters.
          maxLength={16}
          onChangeText={value => {
            setInput(value);
            setFound(null);
            setMessage(null);
          }}
          onSubmitEditing={lookup}
          placeholder={t('friends.friendJupleIdPlaceholder')}
          returnKeyType="search"
          style={[styles.input, ltrTextStyle]}
          testID="friends-add-input"
          value={input}
        />
        <SearchIconButton
          accessibilityLabel={t('collaboration.find')}
          disabled={!canLookUp}
          isLoading={isLookingUp}
          onPress={lookup}
          testID="friends-add-lookup"
        />
      </View>

      {found ? (
        <View style={styles.result} testID="friends-add-result">
          <View style={styles.person}>
            <UserAvatar displayName={found.displayName} imageUrl={found.profileImageUrl} imageVersion={found.profileImageVersion} jupleId={found.jupleId} size={48} />
            <View style={styles.personText}>
              <Text numberOfLines={1} style={styles.name}>{friendPrimaryLabel(found)}</Text>
              {found.displayName?.trim() ? <Text numberOfLines={1} style={[styles.meta, ltrTextStyle]}>{atJupleId(found.jupleId)}</Text> : null}
            </View>
          </View>
          {relationship === 'available' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isSending, busy: isSending }}
              disabled={isSending}
              onPress={send}
              style={styles.primaryButton}
              testID="friends-add-send"
            >
              {isSending ? <ActivityIndicator color={colors.surface} size="small" /> : <Text numberOfLines={2} style={styles.primaryLabel}>{t('friends.sendRequest')}</Text>}
            </Pressable>
          ) : (
            <Text style={styles.status} testID={`friends-add-status-${relationship}`}>
              {relationship === 'self'
                ? t('friends.cannotAddSelf')
                : relationship === 'pending'
                  ? t('friends.requestPending')
                  : relationship === 'incoming'
                    ? t('friends.incomingFromThem')
                    : t('friends.alreadyFriends')}
            </Text>
          )}
          {relationship === 'incoming' ? (
            <Pressable accessibilityRole="button" onPress={onShowIncoming} style={styles.secondaryButtonWide} testID="friends-add-show-incoming">
              <Text numberOfLines={2} style={styles.secondaryLabel}>{t('friends.viewIncoming')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message} testID="friends-add-message">{message}</Text> : null}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textSecondary, fontSize: 14 },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: 64,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonWide: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  result: { gap: spacing.md, marginTop: spacing.lg },
  person: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  personText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  status: { alignSelf: 'stretch', color: colors.textSecondary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: { color: colors.surface, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: spacing.md },
});
