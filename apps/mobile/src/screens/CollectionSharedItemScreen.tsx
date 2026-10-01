import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getSharedCollectionItem, type SharedCollectionItem } from '../collections/api/collectionsApi';
import { describeItemAdder } from '../collections/itemAdder';
import { getCollectionUnlockToken } from '../collections/collectionUnlockGrants';
import { contentGateOfError } from '../collections/useCollectionItems';
import { ContentPreviewCard } from '../components/ContentPreviewCard';
import { ItemAdderBadge } from '../components/ItemAdderBadge';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { getHostnameFromUrl } from '../items/savedLinkPrimaryText';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'CollectionSharedItem'>;

const noop = () => undefined;

/** A little larger than on the cards: here it is the line's subject, not a footnote. */
const ADDER_AVATAR_SIZE = 24;

/**
 * Another member's link inside a shared Category - read-only. Fetched through the Collection
 * (so only a link that is actually in a Category the viewer can open is reachable, and only its
 * shared fields: title, URL, automatic preview image). There is no memo, no uploaded photo, no
 * edit and no delete here: the Item belongs to someone else.
 */
export function CollectionSharedItemScreen({ route }: Props) {
  const { collectionId, itemId } = route.params;
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [item, setItem] = useState<SharedCollectionItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setIsLoading(true);
      setError(null);
      getSharedCollectionItem(authenticatedRequest, collectionId, itemId, getCollectionUnlockToken(collectionId))
        .then(result => {
          if (isActive) {
            setItem(result);
          }
        })
        .catch((caughtError: unknown) => {
          if (!isActive) {
            return;
          }
          const gate = contentGateOfError(caughtError);
          if (gate) {
            setError(t(gate === 'sharePassword' ? 'collections.sharePasswordLockedMessage' : 'collections.lockedMessage'));
          } else if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
            setError(t('collections.sharedItemNotFound'));
          } else {
            setError(t('collections.sharedItemLoadFallback'));
          }
        })
        .finally(() => {
          if (isActive) {
            setIsLoading(false);
          }
        });
      return () => {
        isActive = false;
      };
    }, [authenticatedRequest, collectionId, itemId, t]),
  );

  const openLink = async () => {
    if (!item) {
      return;
    }
    setOpenError(null);
    try {
      await Linking.openURL(item.url);
    } catch {
      setOpenError(t('item.urlOpenFailed'));
    }
  };

  if (isLoading && !item) {
    return (
      <StackScreenSafeArea style={styles.center}>
        <ActivityIndicator />
      </StackScreenSafeArea>
    );
  }

  if (!item) {
    return (
      <StackScreenSafeArea style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </StackScreenSafeArea>
    );
  }

  const hostname = getHostnameFromUrl(item.url) ?? item.url;
  const addedBy = describeItemAdder(item.addedBy, t);

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ContentPreviewCard
          onChangeTitle={noop}
          previewImageUrl={item.previewImageUrl}
          titleEditable={false}
          titlePlaceholder={hostname}
          titleValue={item.title ?? hostname}
        >
          <Text numberOfLines={3} selectable style={styles.url} testID="shared-item-url">
            {item.url}
          </Text>
        </ContentPreviewCard>
        {addedBy ? (
          // Who put this link here - drawn exactly as the Collection's List/Grid cards draw it
          // (avatar, crown for the Owner; the words only for assistive technology).
          <View style={styles.adderRow} testID="shared-item-added-by">
            <Text style={styles.adderLabel}>{t('collections.addedByLabel')}</Text>
            <ItemAdderBadge adder={addedBy} avatarSize={ADDER_AVATAR_SIZE} testID="shared-item-adder" />
          </View>
        ) : null}
        <Text style={styles.readOnlyNote}>{t('collections.sharedItemReadOnly')}</Text>
        <Pressable accessibilityRole="button" onPress={openLink} style={styles.openButton} testID="shared-item-open">
          <ExternalLinkIcon color={colors.surface} size={18} />
          <Text style={styles.openLabel}>{t('collections.sharedItemOpen')}</Text>
        </Pressable>
        {openError ? <Text style={styles.error}>{openError}</Text> : null}
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  content: { padding: spacing.xl },
  url: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.sm,
    writingDirection: 'ltr',
  },
  adderRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  adderLabel: { color: colors.textSecondary, fontSize: 13 },
  readOnlyNote: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.md,
  },
  openButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: minTouchTarget,
  },
  openLabel: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.md, textAlign: 'center' },
});
