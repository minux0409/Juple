import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import {
  getPublicCollection,
  unlockPublicCollection,
  type PublicCollection,
} from '../collections/api/publicCollectionsApi';
import {
  getPublicShareMembership,
  requestToJoinPublicShare,
  savePublicCollection,
  type PublicShareJoinResult,
  type PublicShareMembership,
} from '../collections/api/publicShareWriteApi';
import { CategoryIconTile } from '../collections/CategoryIconTile';
import { shareEntryTileKey } from '../collections/shareEntryTileKey';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KeyboardSafeView } from '../components/KeyboardSafeView';
import { useMessageDialog } from '../components/useMessageDialog';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'SharedCollection'>;

/**
 * The ONE entry for every canonical Collection link (https://<host>/c/{publicId}) inside the installed app - an App Link from KakaoTalk or a
 * browser, a "컬렉션 링크를 보냈어요" notification, a link pasted into the URL field or shared into Juple; cold or warm start. The route name is
 * kept for the existing linking / notification / paste code, but this screen is no longer a list of the Collection's links: it resolves the
 * link and shows exactly one of
 *   - a member (Owner, Contributor, Submitter, Viewer)        -> the normal CollectionDetails
 *   - a nonmember of a PUBLIC link (공용 컬렉션 ON)             -> a centered "컬렉션 추가" dialog: [취소] [저장] (저장 = Viewer at once)
 *   - a nonmember of a PRIVATE link (공용 컬렉션 OFF)           -> a centered "참가 요청" dialog: [취소] [요청] (the Owner approves)
 *   - a nonmember whose request is waiting                      -> "승인 대기 중"
 * The dialogs show only the Collection's own profile (tile and name) - never an item, a URL, a preview or a member - and opening the link
 * creates nothing: membership or a request exists only after the explicit 저장 / 요청. A password-protected link asks for its password first
 * (which by itself saves and requests nothing). The web landing is a separate thing and is untouched.
 */
export function SharedCollectionScreen({ route, navigation }: Props) {
  const { publicId } = route.params;
  const { t } = useTranslation();

  const [collection, setCollection] = useState<PublicCollection | null>(null);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);

  // A protected link's grant after its password was verified: memory only (never stored, never in a URL), bound to this link, and it
  // grants no membership and no identity. The password itself lives only in the field while it is typed.
  const [unlockToken, setUnlockToken] = useState<string | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<'wrong' | 'throttled' | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const isUnlockingRef = useRef(false);

  const { isAuthenticated } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();

  // A signed-in Owner / member never sees an add or request dialog: the link opens their normal Collection. Decided before anything else is
  // shown - cold and warm links take the same path. Anything but a clear "member" (not signed in, not a member, a failed lookup) continues.
  const [isCheckingMembership, setIsCheckingMembership] = useState(isAuthenticated);
  const [membership, setMembership] = useState<PublicShareMembership | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const isBusyRef = useRef(false);
  const { showMessage, messageDialog } = useMessageDialog();

  const refreshMembership = useCallback(() => {
    if (!isAuthenticated) {
      return Promise.resolve();
    }
    return getPublicShareMembership(authenticatedRequest, publicId)
      .then(found => {
        if (found?.isMember && found.collectionId) {
          navigation.replace('CollectionDetails', { collectionId: found.collectionId });
        } else {
          setMembership(found);
        }
      })
      .catch(() => undefined);
  }, [authenticatedRequest, isAuthenticated, navigation, publicId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsCheckingMembership(false);
      return undefined;
    }
    let active = true;
    setIsCheckingMembership(true);
    getPublicShareMembership(authenticatedRequest, publicId)
      .then(found => {
        if (!active) {
          return;
        }
        if (found?.isMember && found.collectionId) {
          navigation.replace('CollectionDetails', { collectionId: found.collectionId });
        } else {
          setMembership(found);
          setIsCheckingMembership(false);
        }
      })
      .catch(() => {
        if (active) {
          setIsCheckingMembership(false);
        }
      });
    return () => {
      active = false;
    };
  }, [authenticatedRequest, isAuthenticated, navigation, publicId]);

  const loadCollection = useCallback(async () => {
    setIsLoadingCollection(true);
    try {
      const fetched = await getPublicCollection(publicId, unlockToken);
      setCollection(fetched);
      setIsUnavailable(false);
    } catch {
      // Unknown publicId, revoked share, or any other load failure: one "unavailable" state, never distinguishing them (mirrors the Web
      // Viewer and the Backend's own unknown/revoked -> 404 rule).
      setCollection(null);
      setIsUnavailable(true);
    } finally {
      setIsLoadingCollection(false);
    }
  }, [publicId, unlockToken]);

  useFocusEffect(
    useCallback(() => {
      loadCollection();
    }, [loadCollection]),
  );

  /** 취소: back where the link was opened from (or Home when it was the first screen, e.g. a cold start). */
  const cancel = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('MainTabs');
    }
  };

  const joinErrorMessage = (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.kind === 'conflict' && error.code === 'joinNotAllowed') {
        return t('sharedCollection.joinNotAllowed');
      }
      if (error.kind === 'forbidden') {
        return t('sharedCollection.joinLocked');
      }
      if (error.kind === 'notFound') {
        return t('sharedCollection.unavailableMessage');
      }
      if (error.kind === 'tooManyRequests') {
        return t('collaboration.tooManyRequests');
      }
    }
    return t('sharedCollection.joinFailed');
  };

  /** One explicit action at a time (저장 or 요청): never repeated while one runs, never automatic. */
  const run = async (action: () => Promise<PublicShareJoinResult>) => {
    if (isBusyRef.current) {
      return;
    }
    isBusyRef.current = true;
    setIsBusy(true);
    try {
      const result = await action();
      if ((result.outcome === 'joined' || result.outcome === 'alreadyMember') && result.collectionId) {
        // A member now: the normal Collection (the Collections list refetches when it regains focus).
        navigation.replace('CollectionDetails', { collectionId: result.collectionId });
        return;
      }
      setMembership(previous => ({ isMember: false, collectionId: null, role: null, ...previous, joinRequestPending: true }));
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.kind === 'forbidden') {
        // The grant ran out (or the link's password changed): back to the locked state, which asks again.
        setUnlockToken(undefined);
      }
      showMessage(joinErrorMessage(caughtError));
      // The Owner may have switched 공용 컬렉션 meanwhile: show the dialog that fits what the link is NOW.
      loadCollection().catch(() => undefined);
      refreshMembership().catch(() => undefined);
    } finally {
      isBusyRef.current = false;
      setIsBusy(false);
    }
  };

  const save = () => run(() => savePublicCollection(authenticatedRequest, publicId, unlockToken));
  const requestJoin = () => run(() => requestToJoinPublicShare(authenticatedRequest, publicId, unlockToken));

  /** Verifies the typed password with the Backend; on success the grant (not the password) is kept in memory and the link reloads. */
  const unlock = async () => {
    if (!password || isUnlockingRef.current) {
      return;
    }
    isUnlockingRef.current = true;
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const grant = await unlockPublicCollection(publicId, password);
      setPassword('');
      setUnlockToken(grant.unlockToken);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.kind === 'forbidden') {
        setUnlockError('wrong');
        setPassword('');
      } else if (caughtError instanceof ApiError && caughtError.kind === 'tooManyRequests') {
        setUnlockError('throttled');
      } else if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
        setIsUnavailable(true);
      } else {
        showMessage(t('sharedCollection.unlockFailed'));
      }
    } finally {
      isUnlockingRef.current = false;
      setIsUnlocking(false);
    }
  };

  if (isCheckingMembership || (isLoadingCollection && !collection && !isUnavailable)) {
    return (
      <SafeAreaView edges={['top']} style={styles.centerContainer}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  // A protected link before its password was proven: nothing of the Collection is known or shown, not even its name.
  if (collection !== null && !isUnavailable && collection.name === null && collection.isLocked) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <KeyboardSafeView>
          <View style={styles.lockedPanel} testID="shared-collection-locked">
            <Text style={styles.lockedTitle}>{t('sharedCollection.lockedTitle')}</Text>
            <Text style={styles.hint}>{t('sharedCollection.lockedMessage')}</Text>
            <TextInput
              accessibilityLabel={t('sharedCollection.passwordLabel')}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              editable={!isUnlocking}
              importantForAutofill="no"
              onChangeText={value => {
                setPassword(value);
                setUnlockError(null);
              }}
              onSubmitEditing={() => { unlock().catch(() => undefined); }}
              placeholder={t('sharedCollection.passwordLabel')}
              secureTextEntry
              style={[styles.input, unlockError === 'wrong' && styles.inputError]}
              testID="shared-collection-unlock-password"
              textContentType="none"
              value={password}
            />
            {unlockError ? (
              <Text style={styles.error} testID="shared-collection-unlock-error">
                {unlockError === 'wrong' ? t('sharedCollection.wrongPassword') : t('sharedCollection.tooManyAttempts')}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isUnlocking || !password, busy: isUnlocking }}
              disabled={isUnlocking || !password}
              onPress={() => { unlock().catch(() => undefined); }}
              style={[styles.primaryButton, (isUnlocking || !password) && styles.disabled]}
              testID="shared-collection-unlock"
            >
              {isUnlocking ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.primaryLabel}>{t('sharedCollection.unlockAction')}</Text>}
            </Pressable>
          </View>
        </KeyboardSafeView>
        {messageDialog}
      </SafeAreaView>
    );
  }

  if (isUnavailable || !collection || collection.name === null) {
    return (
      <SafeAreaView edges={['top']} style={styles.centerContainer}>
        <Text style={styles.unavailableTitle}>{t('sharedCollection.unavailableTitle')}</Text>
        <Text style={styles.unavailableMessage}>{t('sharedCollection.unavailableMessage')}</Text>
      </SafeAreaView>
    );
  }

  const isPublic = collection.isPublic !== false;
  const isWaiting = membership?.joinRequestPending === true;
  const profile = (dim: boolean) => (
    <View style={styles.profile} testID="shared-collection-profile">
      <View style={styles.tileWrap}>
        <View style={dim ? styles.dim : undefined}>
          <CategoryIconTile
            collectionId={shareEntryTileKey(publicId)}
            color={collection.color ?? null}
            icon={collection.icon ?? 'Folder'}
            imageUrl={collection.iconImageUrl ?? null}
            imageVersion={collection.iconImageVersion ?? null}
            size={72}
          />
        </View>
        {dim ? (
          <View pointerEvents="none" style={styles.tileOverlay}>
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : null}
      </View>
      <Text style={styles.profileName} testID="shared-collection-name">{collection.name}</Text>
    </View>
  );

  // The plain background behind the dialog - never any of the Collection's content.
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea} testID="shared-collection-entry">
      {!isAuthenticated ? (
        <ConfirmDialog
          confirmLabel={t('common.confirm')}
          destructive={false}
          message={t('sharedCollection.signInRequired')}
          onConfirm={cancel}
          title={isPublic ? t('sharedCollection.addTitle') : t('sharedCollection.requestTitle')}
          visible
        >
          {profile(false)}
        </ConfirmDialog>
      ) : isWaiting ? (
        <ConfirmDialog
          confirmLabel={t('common.confirm')}
          destructive={false}
          message={t('sharedCollection.joinPendingMessage')}
          onConfirm={cancel}
          title={t('sharedCollection.joinPendingTitle')}
          visible
        >
          {profile(true)}
        </ConfirmDialog>
      ) : isPublic ? (
        <ConfirmDialog
          cancelLabel={t('common.cancel')}
          confirmLabel={t('common.save')}
          destructive={false}
          message=""
          onCancel={() => { if (!isBusy) { cancel(); } }}
          onConfirm={() => { save().catch(() => undefined); }}
          title={t('sharedCollection.addTitle')}
          visible
        >
          {profile(false)}
        </ConfirmDialog>
      ) : (
        <ConfirmDialog
          cancelLabel={t('common.cancel')}
          confirmLabel={t('sharedCollection.requestSend')}
          destructive={false}
          message={t('sharedCollection.privateQuestion')}
          onCancel={() => { if (!isBusy) { cancel(); } }}
          onConfirm={() => { requestJoin().catch(() => undefined); }}
          title={t('sharedCollection.requestTitle')}
          visible
        >
          {profile(false)}
        </ConfirmDialog>
      )}
      {messageDialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centerContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  profile: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  tileWrap: { alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.45 },
  tileOverlay: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  profileName: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  lockedPanel: {
    gap: spacing.sm,
    padding: 24,
  },
  lockedTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  hint: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  input: {
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  inputError: {
    borderColor: colors.danger,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  unavailableTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  unavailableMessage: {
    color: '#666666',
    fontSize: 14,
    textAlign: 'center',
  },
});
