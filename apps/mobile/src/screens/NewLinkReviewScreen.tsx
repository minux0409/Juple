import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// react-native-get-random-values is imported once at the app entry point before anything else can
// call uuid - see pushInstallationId.ts's own remarks on why uuid would otherwise silently fall
// back to a non-cryptographic Math.random() on Hermes.
import { v4 as uuidv4 } from 'uuid';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { addItemToCollection, getCollections, type Collection } from '../collections/api/collectionsApi';
import { CategoryField } from '../collections/CategoryField';
import { CategoryPickerModal } from '../collections/CategoryPickerModal';
import { useCategoryPickerModal } from '../collections/useCategoryPickerModal';
import { saveInboxEntry } from '../inbox/api/inboxApi';
import { uploadItemImage, type ItemImage } from '../images/api/imagesApi';
import { PhotoListEditor } from '../images/PhotoListEditor';
import { MAX_EFFECTIVE_IMAGES, reorderList, type EffectiveImage } from '../items/effectiveImages';
import { setItemCoverImage, setItemPreviewImage, updateItemDetails } from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { isHttpUrl } from '../share/resolveIncomingShare';
import { colors, ltrTextStyle, radii, spacing } from '../theme/tokens';
import { resolveUrlMetadata } from '../urlMetadata/api/urlMetadataApi';
import { checkUrlSafety, type UrlSafetyStatus } from '../urlSafety/api/urlSafetyApi';

const COLLECTION_OPTIONS_PAGE_LIMIT = 50;
// Staged photo removal is instant/local (no server round-trip - see removeStagedPhoto), so
// PhotoListEditor's deletingKeys is always empty here; a stable constant avoids allocating a new
// Set on every render.
const EMPTY_DELETING_KEYS: ReadonlySet<string> = new Set();

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

/** picker/permission failures never reach the server, so this maps react-native-image-picker's own errorCode only. */
function getImagePickerErrorMessage(errorCode: string | undefined, t: TFunction): string {
  if (errorCode === 'permission') {
    return t('item.errorImagePickerPermission');
  }
  return t('item.errorImagePickerFallback');
}

/** Never surfaces raw server/credential/token detail - only a short, actionable localized message. */
function getPhotoUploadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('item.errorImageUploadInvalid');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
    if (error.kind === 'timeout' || error.kind === 'unavailable') {
      return t('item.errorImageUploadNetwork');
    }
  }
  return t('item.errorImageUploadFallback');
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
  // Full Collection objects (not just ids) - CategoryField needs each one's name to render the
  // compact summary row, matching ItemDetailsScreen's own selectedCategories exactly (this round's
  // explicit "같은 선택 방식... 그대로 사용" requirement, which extends this screen from its old
  // single-category chip to the same multi-select picker ItemDetails already has). Seeded from
  // route.params.preselectedCollectionId below once that id's name is resolved.
  const [selectedCollections, setSelectedCollections] = useState<readonly Collection[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [urlSafetyState, setUrlSafetyState] = useState<UrlSafetyDisplayState | null>(null);

  const [isResolvingMetadataTitle, setIsResolvingMetadataTitle] = useState(false);
  // Set only by the user actually typing in the title field (see handleTitleChange) - never by
  // the metadata auto-fill below - so a later-arriving metadata result can tell "the user started
  // typing" apart from "the field is still exactly what it started as".
  const hasUserEditedTitleRef = useRef(false);

  // The same mount-time metadata fetch also resolves a preview image - shown here (unlike before,
  // where it was only silently captured in a ref and applied after Save with no UI at all) so the
  // user can see what will be saved as the auto image before Save even runs. There is no Item yet
  // while this screen is open, so this - and any staged photo below - only become real server
  // state at Save time (see save()). Never blocks Save itself; a still-pending/failed resolve just
  // means no auto image is shown/applied.
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  // The single unified, user-reorderable "사진" list for this not-yet-created Item - 'auto' (the
  // resolved previewImageUrl above) and/or 'staged' (a locally-picked asset, not yet uploaded -
  // see stagedAssetsRef). Never 'uploaded' here; that only exists once the Item is real.
  const [photoOrder, setPhotoOrder] = useState<readonly EffectiveImage[]>([]);
  // Upload-time metadata (MIME type/filename) for each staged photo, keyed by its stagedId - kept
  // out of photoOrder/EffectiveImage itself since that type is shared with ItemDetailsScreen and
  // has no reason to know about picker-specific fields.
  const stagedAssetsRef = useRef<Map<string, { readonly uri: string; readonly type?: string; readonly fileName?: string }>>(
    new Map(),
  );
  const [isPickingPhoto, setIsPickingPhoto] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  // Stable across retries of the SAME url (so a retried Save after a partial failure replays the
  // already-created Item instead of creating a duplicate - see saveInboxEntry's own
  // clientRequestId idempotency), but regenerated the moment the url actually changes, since that
  // is genuinely a different intended save, not a retry of the same one.
  const clientRequestIdRef = useRef<string | null>(null);
  const clientRequestUrlRef = useRef<string | null>(null);

  // route.params.preselectedCollectionId only ever carries an id (see RootStack.tsx's own remarks
  // on why - no Item/staged state exists yet for this not-yet-created Item), so its *name* - needed
  // to actually render it as a selected chip in CategoryField - has to be resolved separately, once,
  // against a fetched page of the user's Collections. Non-fatal and best-effort: if the match isn't
  // found (e.g. past the first page), the id was never captured in local state to begin with, so
  // there is nothing to persist either - Save simply proceeds with no category selected, exactly
  // like any other non-fatal metadata resolution on this screen.
  useEffect(() => {
    if (route.params.preselectedCollectionId === null) {
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const page = await getCollections(authenticatedRequest, { limit: COLLECTION_OPTIONS_PAGE_LIMIT });
        if (!isMounted) {
          return;
        }
        const preselected = page.items.find(option => option.id === route.params.preselectedCollectionId);
        if (preselected) {
          setSelectedCollections(previous =>
            previous.some(existing => existing.id === preselected.id) ? previous : [...previous, preselected],
          );
        }
      } catch {
        // Non-fatal - see this effect's own remarks above.
      }
    })();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only, matching this screen's other mount-only metadata effects.
  }, [authenticatedRequest]);

  // Always attempted once on mount for a URL (never re-fetched as the user edits the url field) -
  // regardless of whether the sharing app already provided a title (route.params.initialTitle).
  // This used to also skip entirely whenever initialTitle was non-null, on the assumption that
  // "we already have a title" meant there was nothing left to resolve - but the preview image is
  // a completely independent signal (see previewImageUrl below), and skipping this whole fetch
  // silently meant most real shares (which usually *do* arrive with some title/EXTRA_SUBJECT)
  // never got a thumbnail at all. The title itself is still never overwritten once non-empty (see
  // the `current === ''` check below) - only the image is unconditionally best-effort resolved. A
  // non-URL review text (kind: 'reviewText') never reaches this, since isHttpUrl guards it. Never
  // blocks Save - a small inline spinner is the only UI effect while it is in flight.
  useEffect(() => {
    if (!isHttpUrl(route.params.url)) {
      return;
    }

    let isMounted = true;
    setIsResolvingMetadataTitle(true);
    resolveUrlMetadata(authenticatedRequest, route.params.url)
      .then(metadata => {
        if (!isMounted) {
          return;
        }
        if (metadata.previewImageUrl) {
          const resolvedImageUrl = metadata.previewImageUrl;
          setPreviewImageUrl(resolvedImageUrl);
          // Defaults to first (matching every other screen's "auto is first unless the user moves
          // it" rule) - but only if the user hasn't already staged a photo and dragged it ahead of
          // where the auto image would land, which this mount-only resolve can't race in practice
          // (staging requires an explicit tap, and this fetch is already in flight by then).
          setPhotoOrder(previous =>
            previous.some(entry => entry.kind === 'auto')
              ? previous
              : [{ kind: 'auto', url: resolvedImageUrl }, ...previous],
          );
        }
        if (hasUserEditedTitleRef.current || !metadata.title) {
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

  const pickAndStagePhoto = async () => {
    if (isPickingPhoto || photoOrder.length >= MAX_EFFECTIVE_IMAGES) {
      return;
    }

    setIsPickingPhoto(true);
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        includeBase64: false,
        assetRepresentationMode: 'compatible',
      });

      if (result.didCancel) {
        return;
      }

      const asset = result.assets?.[0];
      if (result.errorCode || !asset?.uri) {
        setPhotosError(getImagePickerErrorMessage(result.errorCode, t));
        return;
      }

      const stagedId = uuidv4();
      stagedAssetsRef.current.set(stagedId, { uri: asset.uri, type: asset.type, fileName: asset.fileName });
      setPhotosError(null);
      setPhotoOrder(previous => [...previous, { kind: 'staged', stagedId, localUri: asset.uri! }]);
    } finally {
      setIsPickingPhoto(false);
    }
  };

  const removeStagedPhoto = (image: EffectiveImage) => {
    if (image.kind !== 'staged') {
      return;
    }
    stagedAssetsRef.current.delete(image.stagedId);
    setPhotoOrder(previous => previous.filter(entry => !(entry.kind === 'staged' && entry.stagedId === image.stagedId)));
  };

  /** Purely local - nothing to persist yet (there is no Item until Save), so unlike
   * ItemDetailsScreen's own reorder this never calls an API and never fails. */
  const handlePhotoReordered = (fromIndex: number, toIndex: number) => {
    setPhotoOrder(previous => reorderList(previous, fromIndex, toIndex));
  };

  const save = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || isSaving) {
      return;
    }

    // Stable across a retry of this exact url (so saveInboxEntry replays the already-created Item
    // instead of creating a duplicate - see clientRequestIdRef's own remarks), regenerated only if
    // the url itself changed since the last attempt.
    if (clientRequestIdRef.current === null || clientRequestUrlRef.current !== trimmedUrl) {
      clientRequestIdRef.current = uuidv4();
      clientRequestUrlRef.current = trimmedUrl;
    }

    setIsSaving(true);
    setError(null);
    try {
      const savedEntry = await saveInboxEntry(authenticatedRequest, trimmedUrl, clientRequestIdRef.current);

      const trimmedTitle = title.trim();
      const trimmedMemo = memo.trim();
      if (trimmedTitle || trimmedMemo) {
        await updateItemDetails(authenticatedRequest, savedEntry.id, {
          title: trimmedTitle,
          memo: trimmedMemo,
        });
      }

      for (const collection of selectedCollections) {
        await addItemToCollection(authenticatedRequest, collection.id, savedEntry.id);
      }

      // Staged photo(s) upload only now that the Item is real - never before. A failure here
      // leaves the already-created Item exactly as-is (title/memo/category already persisted
      // above) and is surfaced clearly rather than silently dropped; a retried Save replays the
      // same Item via clientRequestId rather than creating a second one, then retries the upload.
      const uploadedByStagedId = new Map<string, ItemImage>();
      for (const stagedEntry of photoOrder) {
        if (stagedEntry.kind !== 'staged') {
          continue;
        }
        const asset = stagedAssetsRef.current.get(stagedEntry.stagedId);
        if (!asset) {
          continue;
        }
        try {
          const uploaded = await uploadItemImage(authenticatedRequest, savedEntry.id, asset);
          uploadedByStagedId.set(stagedEntry.stagedId, uploaded);
        } catch (caughtError) {
          setError(getPhotoUploadErrorMessage(caughtError, t));
          setIsSaving(false);
          return;
        }
      }

      // If the user dragged a staged (now-uploaded) photo ahead of the auto preview, persist that
      // as the cover - mirrors ItemDetailsScreen's own reorder-to-cover mapping. Best-effort: a
      // failure here only means the Home thumbnail defaults back to the auto preview, never a
      // reason to fail the whole Save (the Item and its photo are already safely persisted).
      const front = photoOrder[0];
      if (front?.kind === 'staged') {
        const uploadedFront = uploadedByStagedId.get(front.stagedId);
        if (uploadedFront) {
          setItemCoverImage(authenticatedRequest, savedEntry.id, uploadedFront.id).catch(() => undefined);
        }
      }

      // Best-effort, from the same mount-time metadata fetch the title above already used - never
      // blocks/fails Save itself.
      if (previewImageUrl) {
        setItemPreviewImage(authenticatedRequest, savedEntry.id, previewImageUrl).catch(() => undefined);
      }

      navigation.goBack();
    } catch (caughtError) {
      setError(getSaveErrorMessage(caughtError, t));
    } finally {
      setIsSaving(false);
    }
  };

  // A new category is immediately added to the pool and auto-selected for this not-yet-created
  // Item (this screen's own explicit requirement - unlike ItemDetailsScreen, which never
  // auto-selects a category it creates; see useCategoryPickerModal's own remarks on why that
  // difference lives here, not in the shared hook).
  const categoryPicker = useCategoryPickerModal(authenticatedRequest, t, created =>
    setSelectedCollections(previous => [...previous, created]),
  );
  const selectedCollectionIds = new Set(selectedCollections.map(option => option.id));
  const toggleCategory = (option: Collection) => {
    setSelectedCollections(previous =>
      previous.some(existing => existing.id === option.id)
        ? previous.filter(existing => existing.id !== option.id)
        : [...previous, option],
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/*
          Field order (제목, URL, 카테고리, 메모, 사진) matches ItemDetailsScreen's exactly - this
          round's explicit requirement to unify the two screens' information structure. Category is
          laid out before the photo section on purpose (same as ItemDetails): its position/height
          must never depend on whether an async preview image has arrived yet, and putting it ahead
          of PhotoListEditor in document order means it already has its final layout before that
          async state change can ever touch it.
        */}
        <View style={styles.titleLabelRow}>
          <Text style={styles.firstLabel}>{t('item.titleLabel')}</Text>
          {isResolvingMetadataTitle ? <ActivityIndicator size="small" /> : null}
        </View>
        <TextInput
          editable={!isSaving}
          onChangeText={handleTitleChange}
          placeholder={t('item.titlePlaceholder')}
          style={styles.titleInput}
          value={title}
        />

        <Text style={styles.label}>{t('item.url')}</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          keyboardType="url"
          onChangeText={setUrl}
          style={[styles.urlInput, ltrTextStyle]}
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

        <CategoryField
          error={categoryPicker.error}
          isLoading={false}
          onPress={categoryPicker.open}
          selectedCollections={selectedCollections}
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

        <PhotoListEditor
          deletingKeys={EMPTY_DELETING_KEYS}
          images={photoOrder}
          isAdding={isPickingPhoto}
          onAddPhoto={pickAndStagePhoto}
          onDeleteImage={removeStagedPhoto}
          onReorder={handlePhotoReordered}
        />
        {photosError ? <Text style={styles.error}>{photosError}</Text> : null}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: spacing.md + insets.bottom }]}>
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
      </View>

      <CategoryPickerModal
        bottomInset={insets.bottom}
        collectionPool={categoryPicker.collectionPool}
        error={categoryPicker.error}
        isCreatingCollection={categoryPicker.isCreatingCollection}
        isLoadingMore={categoryPicker.isLoadingMore}
        isLoadingOptions={categoryPicker.isLoadingOptions}
        newCollectionName={categoryPicker.newCollectionName}
        onChangeNewCollectionName={categoryPicker.setNewCollectionName}
        onClose={categoryPicker.close}
        onLoadMore={categoryPicker.loadMore}
        onSubmitNewCollection={categoryPicker.submitNewCollection}
        onToggle={toggleCategory}
        selectedIds={selectedCollectionIds}
        visible={categoryPicker.isVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: 24,
    // Top only - see firstLabel's own remarks on why the very first field doesn't also add its
    // usual marginTop on top of this.
    paddingTop: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 20,
    marginBottom: 6,
  },
  // Same as `label`, but with no marginTop - used only for the URL field's label, the very first
  // thing in the scroll content. `label`'s marginTop exists to separate a field from the one
  // *before* it; stacked on top of `content`'s own paddingTop that doubled the gap between the
  // header and the first field for no reason (every other field still keeps the normal `label`
  // spacing from the field above it).
  firstLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
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
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: 16,
  },
  // Fixed footer, outside the ScrollView (see this screen's return statement) - the save button
  // used to be the ScrollView's last child with insets.bottom folded into the content's own
  // paddingBottom, which only reserved that much *scrollable* space rather than actually pinning
  // the button above the real bottom edge: on a short screen the content never scrolled far enough
  // for that padding to matter, so the button rendered wherever the content naturally ended - which
  // could still be behind the translucent system navigation bar. A fixed sibling bar with its own
  // insets.bottom-aware padding (the same pattern ItemDetailsScreen's bottomBar already uses) is
  // always measured from the screen's actual bottom edge regardless of scroll position or content
  // length, and - since it's a sibling of the ScrollView within a flex:1 column, not inside it -
  // Android's adjustResize keeps it pinned above the keyboard too.
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    marginTop: spacing.sm,
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
