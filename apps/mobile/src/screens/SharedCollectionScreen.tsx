import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getPublicCollection,
  type PublicCollection,
  type PublicCollectionItem,
} from '../collections/api/publicCollectionsApi';
import { usePublicCollectionItems } from '../collections/usePublicCollectionItems';
import type { RootStackParamList } from '../navigation/RootStack';

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
 */
export function SharedCollectionScreen({ route }: Props) {
  const { publicId } = route.params;
  const { t } = useTranslation();

  const [collection, setCollection] = useState<PublicCollection | null>(null);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);

  const { items, isLoading: isLoadingItems, isLoadingMore, loadMore } =
    usePublicCollectionItems(publicId);

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
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item, index) => `${item.url}-${index}`}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <Text numberOfLines={2} style={styles.title}>
            {collection.name}
          </Text>
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
            <Text numberOfLines={2} style={styles.itemTitle}>
              {item.title ?? item.url}
            </Text>
            {item.title ? (
              <Text numberOfLines={1} style={styles.itemUrl}>
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
