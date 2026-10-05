import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { PlusIcon } from '../icons/PlusIcon';
import { StarIcon } from '../icons/StarIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { getCollections, type Collection } from './api/collectionsApi';

/** How many of each kind the one-tap row offers - few on purpose: the rest is the picker. */
const QUICK_RECENT_COUNT = 3;
const QUICK_FAVORITE_COUNT = 2;

export interface QuickCollectionOptions {
  /** Favorites first (starred), then the most recently used/updated - each once, the caller may add links to all of them. */
  readonly options: readonly Collection[];
  readonly favoriteIds: ReadonlySet<number>;
}

/** A viewer cannot add links; everything else the picker already offers. */
function canAddLinksTo(collection: Collection): boolean {
  return collection.accessRole !== 'viewer';
}

/**
 * The few Collections worth one tap in a save dialog: the caller's favorites and the most recent ones - two
 * small page requests (never the whole list), best-effort: a failure just means no shortcuts (the picker is
 * always there), never a blocked save.
 */
export function useQuickCollectionOptions(request: AuthenticatedApiRequest, enabled: boolean = true): QuickCollectionOptions {
  const [state, setState] = useState<QuickCollectionOptions>({ options: [], favoriteIds: new Set() });
  // Loaded once per time the dialog opens - never again because the request function's identity changed.
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let active = true;
    const currentRequest = requestRef.current;
    Promise.all([
      getCollections(currentRequest, { scope: 'favorites', limit: QUICK_FAVORITE_COUNT + 2 }),
      getCollections(currentRequest, { scope: 'all', limit: QUICK_RECENT_COUNT + QUICK_FAVORITE_COUNT + 2 }),
    ])
      .then(([favorites, recent]) => {
        if (!active) {
          return;
        }
        const favoriteList = favorites.items.filter(canAddLinksTo).slice(0, QUICK_FAVORITE_COUNT);
        const favoriteIds = new Set(favoriteList.map(collection => collection.id));
        const recentList = recent.items.filter(collection => canAddLinksTo(collection) && !favoriteIds.has(collection.id)).slice(0, QUICK_RECENT_COUNT);
        setState({ options: [...recentList, ...favoriteList], favoriteIds });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled]);
  return state;
}

interface QuickCollectionChipsProps {
  readonly options: readonly Collection[];
  readonly favoriteIds: ReadonlySet<number>;
  readonly selectedIds: ReadonlySet<number>;
  readonly onToggle: (collection: Collection) => void;
  /** Adds a [+ 새 컬렉션] chip when given. */
  readonly onCreate?: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** One-tap chips: [최근1] [최근2] [★즐겨찾기] ... [+ 새 컬렉션]. A tap selects/unselects at once - no extra step. */
export function QuickCollectionChips({ options, favoriteIds, selectedIds, onToggle, onCreate, disabled = false, testID = 'quick-collections' }: QuickCollectionChipsProps) {
  const { t } = useTranslation();
  if (options.length === 0 && !onCreate) {
    return null;
  }
  return (
    <View style={styles.row} testID={testID}>
      {options.map(collection => {
        const isSelected = selectedIds.has(collection.id);
        const isFavorite = favoriteIds.has(collection.id);
        return (
          <Pressable
            accessibilityLabel={collection.name}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected, disabled }}
            disabled={disabled}
            key={collection.id}
            onPress={() => onToggle(collection)}
            style={[styles.chip, isSelected && styles.chipSelected, disabled && styles.disabled]}
            testID={`${testID}-${collection.id}`}
          >
            {isFavorite ? <StarIcon color={isSelected ? colors.surface : colors.brand} size={14} /> : null}
            <Text numberOfLines={1} style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>{collection.name}</Text>
          </Pressable>
        );
      })}
      {onCreate ? (
        <Pressable
          accessibilityLabel={t('item.newCollectionA11y')}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onCreate}
          style={[styles.chip, styles.chipCreate, disabled && styles.disabled]}
          testID={`${testID}-create`}
        >
          <PlusIcon color={colors.brand} size={14} />
          <Text numberOfLines={1} style={styles.chipLabel}>{t('item.newCollectionChip')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: '100%',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipCreate: { borderColor: colors.brand, borderStyle: 'dashed' },
  chipLabel: { color: colors.textPrimary, flexShrink: 1, fontSize: 14, fontWeight: '600' },
  chipLabelSelected: { color: colors.surface },
  disabled: { opacity: 0.5 },
});
