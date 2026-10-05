import { useCallback, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { AppModal } from '../components/AppModal';
import { LoadFailureState } from '../components/LoadFailureState';
import { UserAvatar } from '../components/UserAvatar';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { FriendDetailModal } from './FriendDetailModal';
import { getFriendRequestErrorMessage } from './AddFriendModal';
import { getFriendRequests, getFriends, sendFriendRequest, type Friend } from './api/friendsApi';
import { atJupleId, friendPrimaryLabel } from './friendIdentity';

/** A person met somewhere in a shared Collection (an adder, a participant): only what the DTOs already carry. */
export interface PersonProfileTarget {
  readonly jupleId: string;
  readonly displayName?: string | null;
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
  /** The signed-in user themselves: shown, but never offered a friend request. */
  readonly isSelf?: boolean;
}

/** What a non-friend's profile can offer, known BEFORE the profile opens. */
export type PersonRelationship = 'self' | 'available' | 'pending' | 'incoming' | 'unknown';

type Destination =
  | { readonly kind: 'friend'; readonly friend: Friend }
  | { readonly kind: 'person'; readonly person: PersonProfileTarget; readonly relationship: PersonRelationship };

/**
 * What tapping a person's avatar in a collaboration context opens - ONE rule for every such avatar (a link's adder, a
 * Collection's participants on Details and on Share). EVERY tap asks the server for the CURRENT relationship first
 * (friendship and friend requests can change on another device - e.g. my request was accepted there), then exactly one
 * destination opens: me -> my own identity (no lookup); an existing friend -> FriendDetailModal directly; a request I
 * sent -> the profile in its request-sent state; one they sent me -> that state; anyone else -> the profile with
 * 친구 요청 보내기. Nothing is shown while resolving, so there is never an intermediate modal that gets swapped. Never a
 * management action: removing someone from a Collection lives only in Share's participant "..." menu.
 *
 * Nothing about a relationship is remembered between taps: the only reuse is that taps while a lookup is in flight
 * share it (no duplicate requests / modals), and the open modal keeps its own state, which this device's actions update
 * at once. Existing APIs only: `GET friends?query=<Juple ID>` (my own friends, by ID) and `GET friends/requests`, in
 * parallel - there is no single-target relationship endpoint.
 */
export function usePersonProfile(): { readonly openProfile: (person: PersonProfileTarget) => void; readonly profileModal: ReactElement } {
  const authenticatedRequest = useAuthenticatedApi();
  const [destination, setDestination] = useState<Destination | null>(null);
  // The lookup in flight (if any): further taps while it runs are the same tap, not new work.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const resolve = useCallback(async (person: PersonProfileTarget) => {
    if (person.isSelf) {
      setDestination({ kind: 'person', person, relationship: 'self' });
      return;
    }
    try {
      const [page, requests] = await Promise.all([
        getFriends(authenticatedRequest, { query: person.jupleId, limit: 20 }),
        getFriendRequests(authenticatedRequest),
      ]);
      const friend = page.items.find(item => item.jupleId === person.jupleId) ?? null;
      if (friend) {
        setDestination({ kind: 'friend', friend });
        return;
      }
      const relationship: PersonRelationship = requests.some(request => request.direction === 'outgoing' && request.jupleId === person.jupleId)
        ? 'pending'
        : requests.some(request => request.direction === 'incoming' && request.jupleId === person.jupleId)
          ? 'incoming'
          : 'available';
      setDestination({ kind: 'person', person, relationship });
    } catch {
      setDestination({ kind: 'person', person, relationship: 'unknown' });
    }
  }, [authenticatedRequest]);

  const run = useCallback((person: PersonProfileTarget) => {
    if (inFlightRef.current) {
      return;
    }
    const lookup = resolve(person).finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = lookup;
  }, [resolve]);

  const close = useCallback(() => setDestination(null), []);

  const profileModal = destination === null ? (
    <></>
  ) : destination.kind === 'friend' ? (
    <FriendDetailModal
      friend={destination.friend}
      onChanged={friend => setDestination({ kind: 'friend', friend })}
      onClose={close}
      onRemoved={close}
    />
  ) : (
    <PersonProfileModal
      onClose={close}
      onRequestSent={() => setDestination({ kind: 'person', person: destination.person, relationship: 'pending' })}
      onRetry={() => run(destination.person)}
      onStale={() => run(destination.person)}
      person={destination.person}
      relationship={destination.relationship}
    />
  );

  return { openProfile: run, profileModal };
}

/** A non-friend's (or my own) identity with its one possible action. Opened only once the relationship is known. */
export function PersonProfileModal({ person, relationship, onClose, onRequestSent, onRetry, onStale }: {
  readonly person: PersonProfileTarget;
  readonly relationship: PersonRelationship;
  readonly onClose: () => void;
  readonly onRequestSent: () => void;
  readonly onRetry: () => void;
  /** The server knew better (already friends / asked either way): re-resolve. */
  readonly onStale: () => void;
}) {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = async () => {
    if (isSending) {
      return;
    }
    setIsSending(true);
    setMessage(null);
    try {
      await sendFriendRequest(authenticatedRequest, person.jupleId);
      onRequestSent();
    } catch (caughtError) {
      setMessage(getFriendRequestErrorMessage(caughtError, t));
      if (caughtError instanceof ApiError && caughtError.kind === 'conflict') {
        onStale();
      }
    } finally {
      setIsSending(false);
    }
  };

  const hasNickname = !!person.displayName?.trim();
  return (
    <AppModal dismissible={!isSending} onClose={onClose} testID="person-profile" title={t('friends.personTitle')} visible>
      <View style={styles.identity}>
        <UserAvatar displayName={person.displayName} imageUrl={person.profileImageUrl} imageVersion={person.profileImageVersion} jupleId={person.jupleId} size={72} />
        <Text numberOfLines={2} style={[styles.name, !hasNickname && ltrTextStyle]} testID="person-profile-name">{friendPrimaryLabel(person)}</Text>
        {hasNickname ? <Text numberOfLines={1} style={[styles.meta, ltrTextStyle]} testID="person-profile-id">{atJupleId(person.jupleId)}</Text> : null}
      </View>
      <View style={styles.actions}>
        {relationship === 'self' ? <Text style={styles.status} testID="person-profile-status-self">{t('friends.you')}</Text> : null}
        {relationship === 'available' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSending, busy: isSending }}
            disabled={isSending}
            onPress={send}
            style={styles.primaryButton}
            testID="person-profile-send"
          >
            {isSending ? <ActivityIndicator color={colors.surface} size="small" /> : <Text numberOfLines={2} style={styles.primaryLabel}>{t('friends.sendRequest')}</Text>}
          </Pressable>
        ) : null}
        {relationship === 'pending' ? <Text style={styles.status} testID="person-profile-status-pending">{t('friends.requestPending')}</Text> : null}
        {relationship === 'incoming' ? <Text style={styles.status} testID="person-profile-status-incoming">{t('friends.incomingFromThem')}</Text> : null}
        {relationship === 'unknown' ? (
          <LoadFailureState compact message={t('friends.loadFallback')} onRetry={onRetry} retryLabel={t('history.retry')} testID="person-profile-error" />
        ) : null}
        {message ? <Text accessibilityLiveRegion="polite" style={styles.message} testID="person-profile-message">{message}</Text> : null}
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: spacing.sm },
  name: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  meta: { color: colors.textSecondary, fontSize: 13 },
  actions: { gap: spacing.md, marginTop: spacing.lg },
  status: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  message: { color: colors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  primaryLabel: { color: colors.surface, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  secondaryLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
