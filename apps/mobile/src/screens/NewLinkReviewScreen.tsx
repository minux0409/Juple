import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import {
  addItemToCollection,
  createCollection,
  getCollections,
  type Collection,
} from '../collections/api/collectionsApi';
import { saveInboxEntry } from '../inbox/api/inboxApi';
import { updateItemDetails } from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { isHttpUrl } from '../share/resolveIncomingShare';
import { colors, radii, spacing } from '../theme/tokens';
import { resolveUrlMetadata } from '../urlMetadata/api/urlMetadataApi';
import { checkUrlSafety, type UrlSafetyStatus } from '../urlSafety/api/urlSafetyApi';

const COLLECTION_OPTIONS_PAGE_LIMIT = 50;

type Props = NativeStackScreenProps<RootStackParamList, 'NewLinkReview'>;

function getSaveErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('inbox.errorBadRequest');
    }
    if (error.kind === 'forbidden') {
      return t('inbox.errorForbidden');
    }
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('inbox.errorSaveFallback');
}

function getCollectionCreateErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('collections.errorNameConflict');
    }
    if (error.kind === 'badRequest') {
      return t('collections.errorNameInvalid');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collections.errorCreateFallback');
}

type UrlSafetyDisplayState = 'checking' | UrlSafetyStatus;

function getUrlSafetyStatusLabel(state: UrlSafetyDisplayState | null, t: TFunction): string | null {
  switch (state) {
    case 'checking':
      return t('urlSafety.checking');
    case 'noKnownThreat':
      return t('urlSafety.noKnownThreat');
    case 'threatDetected':
      return t('urlSafety.threatDetected');
    case 'checkUnavailable':
      return t('urlSafety.checkUnavailable');
    default:
      return null;
  }
}

/** Mirrors the backend's CollectionNameNormalizer: trim, required, 100-character limit. */
function getCollectionNameValidationError(name: string, t: TFunction): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return t('collections.errorNameRequired');
  }
  if (trimmedName.length > 100) {
    return t('collections.errorNameTooLong');
  }
  return null;
}

/**
 * Reached only via IncomingShareRouter (Quick Save OFF, or a leftover Quick Save ON share that
 * still needs review) - never navigated to any other way, and never pre-creates the Item. Save is
 * the only thing that calls the Item API, using the same saveInboxEntry -> updateItemDetails ->
 * addItemToCollection sequence DailyInboxScreen/incomingShareHeadlessTask already use.
 */
export function NewLinkReviewScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();

  const [url, setUrl] = useState(route.params.url);
  const [title, setTitle] = useState(route.params.initialTitle ?? '');
  const [memo, setMemo] = useState('');
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(
    route.params.preselectedCollectionId,
  );

  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(true);

  const [isCreatingCategoryFormVisible, setIsCreatingCategoryFormVisible] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [collectionCreateError, setCollectionCreateError] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [urlSafetyState, setUrlSafetyState] = useState<UrlSafetyDisplayState | null>(null);

  const [isResolvingMetadataTitle, setIsResolvingMetadataTitle] = useState(false);
  // Set only by the user actually typing in the title field (see handleTitleChange) - never by
  // the metadata auto-fill below - so a later-arriving metadata result can tell "the user started
  // typing" apart from "the field is still exactly what it started as".
  const hasUserEditedTitleRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const page = await getCollections(authenticatedRequest, { limit: COLLECTION_OPTIONS_PAGE_LIMIT });
        if (isMounted) {
          setCollections(page.items);
        }
      } catch {
        // Non-fatal - Save still works with no category selected; the user can add one later
        // from ItemDetails.
      } finally {
        if (isMounted) {
          setIsLoadingCollections(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [authenticatedRequest]);

  // Only when the sharing app provided no title at all (route.params.initialTitle === null - see
  // resolveIncomingShare) and only once, on mount - never re-fetched as the user edits the url
  // field. A non-URL review text (kind: 'reviewText') never reaches this, since isHttpUrl guards
  // it. Never blocks Save - a small inline spinner is the only UI effect while it is in flight.
  useEffect(() => {
    if (route.params.initialTitle !== null || !isHttpUrl(route.params.url)) {
      return;
    }

    let isMounted = true;
    setIsResolvingMetadataTitle(true);
    resolveUrlMetadata(authenticatedRequest, route.params.url)
      .then(metadata => {
        if (!isMounted || hasUserEditedTitleRef.current || !metadata.title) {
          return;
        }
        const resolvedTitle = metadata.title;
        setTitle(current => (current === '' ? resolvedTitle : current));
      })
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setIsResolvingMetadataTitle(false);
        }
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only, see remarks above.
  }, []);

  // Best-effort and mount-only for the initial URL, same policy as the metadata title fetch above
  // (never re-run as the user edits the url field) - never blocks Save, which reads url/isSaving
  // only, not this state. A rejected/failed check is shown as checkUnavailable rather than left
  // blank, so the user always sees a definite (if non-committal) outcome instead of a silently
  // stuck spinner.
  useEffect(() => {
    if (!isHttpUrl(route.params.url)) {
      return;
    }

    let isMounted = true;
    setUrlSafetyState('checking');
    checkUrlSafety(authenticatedRequest, route.params.url)
      .then(result => {
        if (isMounted) {
          setUrlSafetyState(result.status);
        }
      })
      .catch(() => {
        if (isMounted) {
          setUrlSafetyState('checkUnavailable');
        }
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only, see remarks above.
  }, []);

  const handleTitleChange = (value: string) => {
    hasUserEditedTitleRef.current = true;
    setTitle(value);
  };

  const save = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const savedEntry = await saveInboxEntry(authenticatedRequest, trimmedUrl);

      const trimmedTitle = title.trim();
      const trimmedMemo = memo.trim();
      if (trimmedTitle || trimmedMemo) {
        await updateItemDetails(authenticatedRequest, savedEntry.id, {
          title: trimmedTitle,
          memo: trimmedMemo,
        });
      }

      if (selectedCollectionId !== null) {
        await addItemToCollection(authenticatedRequest, selectedCollectionId, savedEntry.id);
      }

      navigation.goBack();
    } catch (caughtError) {
      setError(getSaveErrorMessage(caughtError, t));
    } finally {
      setIsSaving(false);
    }
  };

  const submitNewCollection = async () => {
    if (isCreatingCollection) {
      return;
    }

    const validationError = getCollectionNameValidationError(newCollectionName, t);
    if (validationError) {
      setCollectionCreateError(validationError);
      return;
    }
    const trimmedName = newCollectionName.trim();

    setIsCreatingCollection(true);
    setCollectionCreateError(null);
    try {
      const created = await createCollection(authenticatedRequest, trimmedName);
      setCollections(previous => [...previous, created]);
      setSelectedCollectionId(created.id);
      setNewCollectionName('');
      setIsCreatingCategoryFormVisible(false);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      setCollectionCreateError(getCollectionCreateErrorMessage(caughtError, t));
    } finally {
      setIsCreatingCollection(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>{t('item.url')}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isSaving}
        keyboardType="url"
        onChangeText={setUrl}
        style={styles.urlInput}
        value={url}
      />
      {urlSafetyState ? (
        <Text
          style={[
            styles.urlSafetyStatus,
            urlSafetyState === 'threatDetected' && styles.urlSafetyStatusWarning,
          ]}
        >
          {getUrlSafetyStatusLabel(urlSafetyState, t)}
        </Text>
      ) : null}

      <View style={styles.titleLabelRow}>
        <Text style={styles.label}>{t('item.titleLabel')}</Text>
        {isResolvingMetadataTitle ? <ActivityIndicator size="small" /> : null}
      </View>
      <TextInput
        editable={!isSaving}
        onChangeText={handleTitleChange}
        placeholder={t('item.titlePlaceholder')}
        style={styles.titleInput}
        value={title}
      />

      <Text style={styles.label}>{t('item.memo')}</Text>
      <TextInput
        editable={!isSaving}
        multiline
        onChangeText={setMemo}
        placeholder={t('item.memoPlaceholder')}
        style={styles.memoInput}
        value={memo}
      />

      <View style={styles.categoryHeaderRow}>
        <Text style={styles.categoryHeaderLabel}>{t('quickSaveComposer.categoryLabel')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsCreatingCategoryFormVisible(previous => !previous)}
          style={styles.addCategoryButton}
        >
          <Text style={styles.addCategoryButtonLabel}>{t('collections.addNew')}</Text>
        </Pressable>
      </View>

      {isCreatingCategoryFormVisible ? (
        <View style={styles.newCategoryRow}>
          <TextInput
            autoFocus
            editable={!isCreatingCollection}
            onChangeText={setNewCollectionName}
            placeholder={t('collections.namePlaceholder')}
            style={styles.newCategoryInput}
            value={newCollectionName}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: !newCollectionName.trim() || isCreatingCollection,
              busy: isCreatingCollection,
            }}
            disabled={!newCollectionName.trim() || isCreatingCollection}
            onPress={submitNewCollection}
            style={[
              styles.newCategoryButton,
              (!newCollectionName.trim() || isCreatingCollection) && styles.disabledButton,
            ]}
          >
            <Text style={styles.newCategoryButtonLabel}>{t('collections.create')}</Text>
          </Pressable>
        </View>
      ) : null}
      {collectionCreateError ? <Text style={styles.error}>{collectionCreateError}</Text> : null}

      {isLoadingCollections ? (
        <ActivityIndicator style={styles.categoriesLoading} />
      ) : (
        <View style={styles.categoryRow}>
          <CategoryChip
            isSelected={selectedCollectionId === null}
            label={t('quickSaveComposer.categoryNone')}
            onPress={() => setSelectedCollectionId(null)}
          />
          {collections.map(collection => (
            <CategoryChip
              key={collection.id}
              isSelected={selectedCollectionId === collection.id}
              label={collection.name}
              onPress={() => setSelectedCollectionId(collection.id)}
            />
          ))}
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !url.trim() || isSaving, busy: isSaving }}
        disabled={!url.trim() || isSaving}
        onPress={save}
        style={[styles.saveButton, (!url.trim() || isSaving) && styles.disabledButton]}
      >
        <Text style={styles.saveButtonLabel}>{isSaving ? t('common.saving') : t('common.save')}</Text>
      </Pressable>
    </ScrollView>
  );
}

interface CategoryChipProps {
  readonly label: string;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}

function CategoryChip({ label, isSelected, onPress }: CategoryChipProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={[styles.chip, isSelected && styles.chipSelected]}
    >
      <Text numberOfLines={1} style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 20,
    marginBottom: 6,
  },
  titleLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  urlInput: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  titleInput: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  urlSafetyStatus: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  urlSafetyStatusWarning: {
    color: colors.danger,
    fontWeight: '600',
  },
  memoInput: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 100,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  categoryHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  categoryHeaderLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  addCategoryButton: {
    paddingVertical: spacing.xs,
  },
  addCategoryButtonLabel: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '600',
  },
  newCategoryRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  newCategoryInput: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    fontSize: 15,
    marginEnd: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm + 2,
  },
  newCategoryButton: {
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  newCategoryButtonLabel: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '600',
  },
  categoriesLoading: {
    marginTop: spacing.sm,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    maxWidth: 160,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipSelected: {
    backgroundColor: colors.textPrimary,
  },
  chipLabel: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  chipLabelSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: 16,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    marginTop: 24,
    paddingVertical: 12,
  },
  saveButtonLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
