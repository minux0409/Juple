import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { linkProposalErrorMessage } from '../collections/linkProposals';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import {
  getPublicCollection,
  type PublicCollection,
  type PublicCollectionItem,
} from '../collections/api/publicCollectionsApi';
import { addLinkToPublicCollection, getMyPublicSubmissions } from '../collections/api/publicShareWriteApi';
import { ChevronIcon } from '../icons/ChevronIcon';
import { usePublicCollectionItems } from '../collections/usePublicCollectionItems';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { KeyboardSafeView } from '../components/KeyboardSafeView';

type Props = NativeStackScreenProps<RootStackParamList, 'SharedCollection'>;

/**
 * The read-only counterpart to CollectionDetailsScreen for a Collection Sharing link
 * (https://<host>/c/{publicId} or the Web Viewer's own "open in app" - see navigation/linking.ts).
 * Reachable with or without authentication (see RootStack.tsx) and backed entirely by the
 * anonymous Public API (see collections/api/publicCollectionsApi.ts) - never the authenticated
 * Collection API, even when the viewer happens to be signed in. Deliberately does not reuse
 * CollectionDetailsScreen: that screen's owner actions (rename/delete/favorite/membership/share
 * management) and private fields (Memo/Category/Purchase/RepeatPurchase) have no anonymous
 * equivalent and must never be reachable from a link handed to someone else.
 *
 * The one exception to "anonymous only": when the link is writable (모든 사용자: 작성) and the
 * viewer is signed in, they may add a link of their own - that single call uses their session (see
 * publicShareWriteApi); reading still never does. Signed out, the add area only says to sign in.
 */
export function SharedCollectionScreen({ route, navigation }: Props) {
  const { publicId } = route.params;
  const { t } = useTranslation();
  // A stack screen, not a tab screen - see CollectionDetailsScreen's identical remark.
  const insets = useSafeAreaInsets();

  const [collection, setCollection] = useState<PublicCollection | null>(null);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);

  const { items, isLoading: isLoadingItems, isLoadingMore, loadMore, reload } =
    usePublicCollectionItems(publicId);
  const { isAuthenticated } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();
  const [newUrl, setNewUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const isAddingRef = useRef(false);
  // A signed-in viewer's OWN links waiting for the Owner through this link (승인 후 추가) - the one number
  // this public view may show beyond the links: never the Owner's queue, never anyone else's.
  const [myPendingCount, setMyPendingCount] = useState(0);
  const [addMessage, setAddMessage] = useState<{ kind: 'error' | 'done'; text: string } | null>(null);

  const addErrorMessage = (error: unknown): string => {
    const proposalMessage = linkProposalErrorMessage(error, t);
    if (proposalMessage) {
      return proposalMessage;
    }
    if (error instanceof ApiError) {
      if (error.kind === 'badRequest') {
        return t('sharedCollection.addInvalidUrl');
      }
      if (error.kind === 'forbidden' || error.kind === 'notFound') {
        return t('sharedCollection.addNotAllowed');
      }
      if (error.kind === 'tooManyRequests') {
        return t('collaboration.tooManyRequests');
      }
    }
    return t('sharedCollection.addFallback');
  };

  /** Saves the URL to the viewer's own library, then adds it here - one tap, never twice at once. */
  const addLink = async () => {
    const url = newUrl.trim();
    if (!url || isAddingRef.current) {
      return;
    }
    isAddingRef.current = true;
    setIsAdding(true);
    setAddMessage(null);
    try {
      const outcome = await addLinkToPublicCollection(authenticatedRequest, publicId, url);
      setNewUrl('');
      if (outcome === 'submitted') {
        // 승인 후 추가: it waits for the Owner - nothing new in the list yet.
        setAddMessage({ kind: 'done', text: t('collections.linkSubmitted') });
        loadMyPending().catch(() => undefined);
      } else {
        setAddMessage({ kind: 'done', text: t('sharedCollection.addDone') });
        await reload();
      }
    } catch (caughtError) {
      setAddMessage({ kind: 'error', text: addErrorMessage(caughtError) });
    } finally {
      isAddingRef.current = false;
      setIsAdding(false);
    }
  };

  const loadCollection = useCallback(async () => {
    setIsLoadingCollection(true);
    try {
      const fetched = await getPublicCollection(publicId);
      setCollection(fetched);
      setIsUnavailable(false);
    } catch {
      // Unknown publicId, revoked share, or any other load failure - a read-only public viewer
      // has no owner to notify and no retry affordance beyond navigating back to the link again,
      // so every failure collapses to the same "unavailable" state (mirrors the Web Viewer and
      // the Backend's own unknown/revoked -> 404 rule).
      setCollection(null);
      setIsUnavailable(true);
    } finally {
      setIsLoadingCollection(false);
    }
  }, [publicId]);

  useFocusEffect(
    useCallback(() => {
      loadCollection();
    }, [loadCollection]),
  );

  // Own pending count: only for a signed-in viewer of a link that is open to them (not password-locked
  // here). Any failure - the link was switched off, no session - simply shows nothing (never an error).
  const isOpenToViewer = isAuthenticated && collection !== null && !collection.isLocked;
  const loadMyPending = useCallback(async () => {
    if (!isOpenToViewer) {
      setMyPendingCount(0);
      return;
    }
    try {
      const page = await getMyPublicSubmissions(authenticatedRequest, publicId);
      setMyPendingCount(page.totalCount ?? page.items.length);
    } catch {
      setMyPendingCount(0);
    }
  }, [authenticatedRequest, isOpenToViewer, publicId]);
  useFocusEffect(
    useCallback(() => {
      loadMyPending().catch(() => undefined);
    }, [loadMyPending]),
  );

  const openItem = async (item: PublicCollectionItem) => {
    try {
      await Linking.openURL(item.url);
    } catch {
      // Nothing else to do from a read-only public viewer if the OS can't open it - no owner
      // error banner state exists here to report into (see ItemDetailsScreen for the owned
      // equivalent, which does have one).
    }
  };

  if (isLoadingCollection && !collection && !isUnavailable) {
    return (
      <SafeAreaView edges={['top']} style={styles.centerContainer}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (isUnavailable || !collection) {
    return (
      <SafeAreaView edges={['top']} style={styles.centerContainer}>
        <Text style={styles.unavailableTitle}>{t('sharedCollection.unavailableTitle')}</Text>
        <Text style={styles.unavailableMessage}>{t('sharedCollection.unavailableMessage')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <KeyboardSafeView>
      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
        data={items}
        keyExtractor={(item, index) => `${item.url}-${index}`}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        // No numberOfLines - a long or foreign-language category name must be fully readable
        // here too (this is the read-only public counterpart of CollectionDetailsScreen, which
        // dropped its own title truncation for the same reason).
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>{collection.name}</Text>
            {myPendingCount > 0 ? (
              <Pressable
                accessibilityLabel={t('collections.myPendingSubmissionsA11y', { count: myPendingCount })}
                accessibilityRole="button"
                onPress={() => navigation.navigate('MyCollectionSubmissions', { publicId })}
                style={styles.myPendingRow}
                testID="shared-collection-my-pending"
              >
                <Text numberOfLines={2} style={styles.myPendingLabel}>{t('collections.myPendingSubmissions', { count: myPendingCount })}</Text>
                <ChevronIcon color={colors.textSecondary} direction="right" size={16} />
              </Pressable>
            ) : null}
            {(collection.permission === 'write' || collection.permission === 'submit') && !collection.isLocked ? (
              <View style={styles.addCard} testID="shared-collection-add">
                {isAuthenticated ? (
                  <>
                    <View style={styles.addRow}>
                      <TextInput
                        accessibilityLabel={t('sharedCollection.addUrlLabel')}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!isAdding}
                        keyboardType="url"
                        onChangeText={setNewUrl}
                        onSubmitEditing={addLink}
                        placeholder={t('sharedCollection.addUrlPlaceholder')}
                        style={[styles.addInput, ltrTextStyle]}
                        testID="shared-collection-add-url"
                        value={newUrl}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isAdding || !newUrl.trim(), busy: isAdding }}
                        disabled={isAdding || !newUrl.trim()}
                        onPress={addLink}
                        style={[styles.addButton, (isAdding || !newUrl.trim()) && styles.disabled]}
                        testID="shared-collection-add-submit"
                      >
                        {isAdding ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.addButtonLabel}>{t('sharedCollection.addAction')}</Text>}
                      </Pressable>
                    </View>
                    <Text style={styles.addHelp}>
                      {collection.permission === 'submit' ? t('sharedCollection.addSubmitNote') : t('sharedCollection.addVisibilityNote')}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.addHelp} testID="shared-collection-add-sign-in">{t('sharedCollection.addSignInRequired')}</Text>
                )}
                {addMessage ? (
                  <Text style={addMessage.kind === 'error' ? styles.addError : styles.addDone} testID="shared-collection-add-message">{addMessage.text}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !isLoadingItems ? <Text style={styles.empty}>{t('sharedCollection.itemsEmpty')}</Text> : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              openItem(item);
            }}
            style={styles.row}
          >
            <Text numberOfLines={2} style={[styles.itemTitle, !item.title && ltrTextStyle]}>
              {item.title ?? item.url}
            </Text>
            {item.title ? (
              <Text numberOfLines={1} style={[styles.itemUrl, ltrTextStyle]}>
                {item.url}
              </Text>
            ) : null}
          </Pressable>
        )}
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator />
            </View>
          ) : undefined
        }
      />
      </KeyboardSafeView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  empty: {
    color: '#666666',
    fontSize: 14,
    paddingVertical: 16,
  },
  row: {
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    paddingVertical: 14,
  },
  itemTitle: {
    color: '#111111',
    fontSize: 15,
  },
  itemUrl: {
    color: '#666666',
    fontSize: 13,
    marginTop: 3,
  },
  footerLoading: {
    paddingVertical: 20,
  },
  myPendingRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  myPendingLabel: { color: colors.textPrimary, flex: 1, fontSize: 15, fontWeight: '600', minWidth: 0 },
  addCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  addRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  addInput: {
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: 72,
    paddingHorizontal: spacing.md,
  },
  addButtonLabel: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '700',
  },
  addHelp: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  addError: {
    color: colors.danger,
    fontSize: 14,
  },
  addDone: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '600',
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
