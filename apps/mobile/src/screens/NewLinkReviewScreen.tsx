import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { ContentPreviewCard } from '../components/ContentPreviewCard';
import { SourceRow } from '../components/SourceRow';
import { EditIcon } from '../icons/EditIcon';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { saveInboxEntry } from '../inbox/api/inboxApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { uploadItemImage, type ItemImage } from '../images/api/imagesApi';
import { PhotoListEditor } from '../images/PhotoListEditor';
import { MAX_EFFECTIVE_IMAGES, reorderList, type EffectiveImage } from '../items/effectiveImages';
import { setItemCoverImage, setItemPreviewImage, updateItemDetails } from '../items/api/itemsApi';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import type { RootStackParamList } from '../navigation/RootStack';
import { registerActiveNewLinkReviewDraft, clearActiveNewLinkReviewDraft } from '../share/activeNewLinkReviewDraft';
import { isHttpUrl, normalizeShareTextForComparison, resolveIncomingShare } from '../share/resolveIncomingShare';
import type { PendingShare } from '../share/specs/NativeIncomingShare';
import { useIncomingShare } from '../share/useIncomingShare';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { resolveUrlMetadata } from '../urlMetadata/api/urlMetadataApi';

const COLLECTION_OPTIONS_PAGE_LIMIT = 50;

/**
 * Defensive-only, YouTube-gated filter: the current DEV Backend can still return "YouTube"/
 * "- YouTube" as og:title/twitter:title/<title> for a video whose own server-side title lookup
 * failed (Backend already has its own fix for this in HtmlTitleExtractor - see that file's own
 * remarks - but this client keeps its own copy so a real, already-correct share-provided
 * initialTitle is never clobbered by a stale Backend still running the old code in the meantime).
 * Reuses resolveSiteInfo (the same host classification SiteIcon/saved-link rows already use)
 * rather than duplicating YouTube's host list, and never applies to any other site - a page whose
 * real, author-chosen title happens to be the bare word "YouTube" must still be trusted verbatim
 * everywhere except youtube.com itself.
 */
function isKnownYouTubePlaceholderTitle(url: string, title: string): boolean {
  if (resolveSiteInfo(url).id !== 'youtube') {
    return false;
  }
  const normalized = title.trim().toLowerCase();
  return normalized === 'youtube' || normalized === '- youtube';
}
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

  const { acknowledgePendingShare } = useIncomingShare();

  const [url, setUrl] = useState(route.params.url);
  // Live mirror of `url` for activeNewLinkReviewDraft's getNormalizedUrl - read imperatively by
  // IncomingShareRouter (a component outside this screen's own render tree), not through state.
  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);
  // Set only by IncomingShareRouter handing off a DIFFERENT-URL incoming share while this draft is
  // open (see activeNewLinkReviewDraft.ts) - drives both the conflict ConfirmDialog's visibility
  // and which share resolveConflictWithSave/resolveConflictWithDiscard below act on. Never cleared
  // on a failed "save and continue" attempt (see resolveConflictWithSave) so the user can still
  // retry either button afterward - only cleared once the hand-off to the new share actually
  // completes.
  const [pendingConflictShare, setPendingConflictShare] = useState<PendingShare | null>(null);
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

  // Compact source row (icon + site name) by default - raw URL text only appears while the user has
  // deliberately opened it for editing (e.g. fixing a malformed shared URL), never as a passive
  // display. Starts collapsed even for a non-http review text (kind: 'reviewText'), which still
  // needs to be editable the same way.
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [urlOpenError, setUrlOpenError] = useState<string | null>(null);

  const [isResolvingMetadataTitle, setIsResolvingMetadataTitle] = useState(false);
  // Set only when the metadata fetch itself throws (network/timeout/server error) - never for a
  // clean resolution that simply found no title/image, which is not a failure worth surfacing.
  // Shown as a small, non-blocking hint once resolution finishes; never re-blocks Save.
  const [metadataResolutionFailed, setMetadataResolutionFailed] = useState(false);
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
  // Live mirror of photoOrder for the metadata-resolution effect below (a plain mount-time effect,
  // not re-run on every photoOrder change) to read the *current* staged state at the moment
  // metadata actually arrives, not whatever it was when the effect was set up.
  const photoOrderRef = useRef(photoOrder);
  useEffect(() => {
    photoOrderRef.current = photoOrder;
  }, [photoOrder]);
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

  // Registers this screen instance as "the" active unsaved draft (see activeNewLinkReviewDraft.ts)
  // for as long as it's mounted - RootStack.tsx only ever mounts one NewLinkReviewScreen at a
  // time, and this screen is a draft (an unsaved, not-yet-created Item) from the moment it opens,
  // not only once the user has actually edited a field - see that file's own "URL만 로딩 중인
  // draft를 놓치지 않는다" requirement. Registered once on mount (mount-only effect); the object
  // itself is stable for the screen's whole lifetime, so clearActiveNewLinkReviewDraft on unmount
  // is guaranteed to clear exactly this registration and never a newer one.
  useEffect(() => {
    const draft = {
      getNormalizedUrl: () => normalizeShareTextForComparison(urlRef.current),
      onConflictingShare: (share: PendingShare) => setPendingConflictShare(share),
    };
    registerActiveNewLinkReviewDraft(draft);
    return () => clearActiveNewLinkReviewDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only registration; the closure reads urlRef.current live and setPendingConflictShare is stable.
  }, []);

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
  // never got a thumbnail at all.
  //
  // Title precedence (highest wins): user edit > resolved Backend metadata title > share-provided
  // initialTitle > empty - except when the resolved metadata title is a known YouTube placeholder
  // (see isKnownYouTubePlaceholderTitle above), in which case it is treated as if Backend found no
  // title at all, dropping precedence to initialTitle > empty instead. hasUserEditedTitleRef (set
  // only by handleTitleChange, see below) is the sole user-edit gate - once true, this resolve
  // must never touch title again, no matter what arrives. This used to also gate on the title's
  // current *value* being exactly '' before applying a resolved title, on the mistaken assumption
  // that "non-empty" meant "the user already has something worth keeping" - but a non-empty title
  // at this point is just as often the sharing app's own EXTRA_SUBJECT (e.g. the raw shared text,
  // or a caption, never something the user actually typed), which the real, more accurate
  // Backend-resolved title should still be trusted to replace. A non-URL review text
  // (kind: 'reviewText') never reaches this, since isHttpUrl guards it. Never blocks Save - a
  // small inline spinner is the only UI effect while it is in flight.
  useEffect(() => {
    if (!isHttpUrl(route.params.url)) {
      return;
    }

    let isMounted = true;
    setIsResolvingMetadataTitle(true);
    setMetadataResolutionFailed(false);
    resolveUrlMetadata(authenticatedRequest, route.params.url)
      .then(metadata => {
        if (!isMounted) {
          return;
        }
        // Skipped entirely once the user has already staged their own photo - picking one from
        // the OS library realistically takes longer than this network round-trip, so a late-
        // arriving auto image prepending itself ahead of (or alongside) the user's own choice is
        // a real race, not a hypothetical one. previewImageUrl and photoOrder are always updated
        // together here so ContentPreviewCard's top image and the photo list below it never
        // disagree about whether an auto image exists.
        if (metadata.previewImageUrl && !photoOrderRef.current.some(entry => entry.kind === 'staged')) {
          const resolvedImageUrl = metadata.previewImageUrl;
          setPreviewImageUrl(resolvedImageUrl);
          // Defaults to first (matching every other screen's "auto is first unless the user moves
          // it" rule).
          setPhotoOrder(previous =>
            previous.some(entry => entry.kind === 'auto')
              ? previous
              : [{ kind: 'auto', url: resolvedImageUrl }, ...previous],
          );
        }
        // A known YouTube placeholder (see isKnownYouTubePlaceholderTitle) is treated exactly like
        // "no title" here - title simply stays whatever it already was (the share-provided
        // initialTitle, or empty), never the placeholder itself.
        if (
          hasUserEditedTitleRef.current
          || !metadata.title
          || isKnownYouTubePlaceholderTitle(route.params.url, metadata.title)
        ) {
          return;
        }
        setTitle(metadata.title);
      })
      .catch(() => {
        if (isMounted) {
          setMetadataResolutionFailed(true);
        }
      })
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

  const handleTitleChange = (value: string) => {
    hasUserEditedTitleRef.current = true;
    setTitle(value);
  };

  const openUrl = async () => {
    setUrlOpenError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setUrlOpenError(t('item.urlOpenFailed'));
    }
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

  /** The user confirmed making the photo at `index` the new representative/cover photo (see
   * PhotoListEditor's own tap+confirm UX) - purely local, nothing to persist yet (there is no
   * Item until Save), so unlike ItemDetailsScreen's own version this never calls an API and never
   * fails. */
  const setPhotoAsRepresentative = (index: number) => {
    setPhotoOrder(previous => reorderList(previous, index, 0));
  };

  // onSuccess defaults to the plain "go back to whatever opened this screen" behavior the Save
  // button has always had; the active-draft conflict flow below passes its own onSuccess instead
  // (acknowledge the pending share + replace this screen with a fresh one for the new URL) so it
  // can reuse this exact same save sequence rather than duplicating it - this round's explicit
  // "별도 save implementation 만들지 않는다" requirement. The existing `isSaving` guard just below
  // already makes a second concurrent call to save() (from either caller) a no-op, so the conflict
  // dialog's "저장 후 계속" button never risks a double save even on a fast double-tap.
  const save = async (onSuccess: () => void = () => navigation.goBack()) => {
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
      // as the cover - mirrors ItemDetailsScreen's own reorder-to-cover mapping. Best-effort in the
      // sense that a failure here never fails the whole Save (the Item and its photo are already
      // safely persisted) - but still AWAITED before navigating back. Firing this without awaiting
      // it used to let navigation.goBack() run immediately, which hands control straight back to
      // Home's own useFocusEffect refetch - a real race that intermittently showed a just-saved
      // Item with no thumbnail until a later, unrelated refresh caught up. Awaiting here (even
      // though the outcome is only ever best-effort) guarantees Home's refetch, once it does run,
      // always sees this write already committed.
      const front = photoOrder[0];
      if (front?.kind === 'staged') {
        const uploadedFront = uploadedByStagedId.get(front.stagedId);
        if (uploadedFront) {
          await setItemCoverImage(authenticatedRequest, savedEntry.id, uploadedFront.id).catch(() => undefined);
        }
      }

      // Best-effort, from the same mount-time metadata fetch the title above already used - never
      // blocks/fails Save itself, but still awaited for the same reason as setItemCoverImage above.
      if (previewImageUrl) {
        await setItemPreviewImage(authenticatedRequest, savedEntry.id, previewImageUrl).catch(() => undefined);
      }

      onSuccess();
    } catch (caughtError) {
      setError(getSaveErrorMessage(caughtError, t));
    } finally {
      setIsSaving(false);
    }
  };

  // Hands the now-resolved conflict share off to a brand-new NewLinkReview instance -
  // navigation.replace (not navigate) is deliberate: unlike navigate, it always creates a fresh
  // route with a new key, which is what actually remounts this screen and gives every piece of
  // local state (title/memo/categories/photos/hasUserEditedTitleRef/photoOrderRef/metadata loading
  // state) a clean start - see this codebase's existing CollectionDetailsScreen merge-navigation
  // for the same replace-for-a-fresh-instance convention. acknowledgePendingShare only happens
  // here, once the hand-off is actually committed - never earlier, so a save failure (see
  // resolveConflictWithSave) never loses the pending share.
  const completeConflictHandoff = (share: PendingShare) => {
    const resolved = resolveIncomingShare(share);
    setPendingConflictShare(null);
    acknowledgePendingShare(share.id).catch(() => undefined);
    navigation.replace('NewLinkReview', {
      url: resolved.text,
      initialTitle: resolved.title,
      preselectedCollectionId: share.draftCollectionId ?? share.preselectedCollectionId,
    });
  };

  // "저장 후 계속" - runs the exact same save() the main Save button uses, just with a different
  // onSuccess. On failure, save() already sets `error` and resets `isSaving` on its own;
  // pendingConflictShare is deliberately left untouched here so the dialog stays open and the user
  // can retry either button - the new share is never silently dropped.
  const resolveConflictWithSave = () => {
    if (!pendingConflictShare) {
      return;
    }
    const share = pendingConflictShare;
    save(() => completeConflictHandoff(share));
  };

  // "버리고 계속" - never calls save() at all; the current draft's local state is simply abandoned
  // (nothing was ever persisted for it) and completeConflictHandoff's navigation.replace gives the
  // new share a fully fresh screen instance, so none of the discarded draft's state can leak in.
  const resolveConflictWithDiscard = () => {
    if (!pendingConflictShare) {
      return;
    }
    completeConflictHandoff(pendingConflictShare);
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

          Title + source are visually grouped into one "content preview" card (this round's visual
          redesign - "폼 입력" feel replaced with "리뷰 중인 콘텐츠 하나" feel) instead of two
          separately labeled form fields, but their order/semantics/state are completely unchanged -
          still the exact same editable title TextInput and the exact same SourceRow/pencil-edit-url
          toggle as before, just presented inside a single bordered card with the resolved preview
          image (when one exists) up top.
        */}
        <ContentPreviewCard
          onChangeTitle={handleTitleChange}
          previewImageUrl={previewImageUrl}
          titleAccessibilityLabel={t('item.titleLabel')}
          titleEditable={!isSaving}
          titleHint={
            !isResolvingMetadataTitle && metadataResolutionFailed ? (
              <Text style={styles.metadataResolutionFailedHint}>{t('item.metadataResolutionFailedHint')}</Text>
            ) : null
          }
          titlePlaceholder={t('item.titlePlaceholder')}
          titleValue={title}
        >
          {isEditingUrl ? (
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              editable={!isSaving}
              keyboardType="url"
              onBlur={() => setIsEditingUrl(false)}
              onChangeText={setUrl}
              style={[styles.urlInput, ltrTextStyle]}
              value={url}
            />
          ) : (
            <SourceRow
              trailing={
                <View style={styles.sourceActions}>
                  <Pressable
                    accessibilityLabel={t('item.goToUrlA11y')}
                    accessibilityRole="button"
                    onPress={openUrl}
                    style={styles.iconButton}
                  >
                    <ExternalLinkIcon color={colors.brand} size={20} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={t('common.edit')}
                    accessibilityRole="button"
                    disabled={isSaving}
                    onPress={() => setIsEditingUrl(true)}
                    style={[styles.iconButton, isSaving && styles.disabledButton]}
                  >
                    <EditIcon color={colors.textSecondary} size={18} />
                  </Pressable>
                </View>
              }
              url={url}
            />
          )}
          {urlOpenError ? <Text style={styles.error}>{urlOpenError}</Text> : null}
        </ContentPreviewCard>

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
          onSetRepresentative={setPhotoAsRepresentative}
        />
        {photosError ? <Text style={styles.error}>{photosError}</Text> : null}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: spacing.md + insets.bottom }]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !url.trim() || isSaving || isResolvingMetadataTitle, busy: isSaving }}
          disabled={!url.trim() || isSaving || isResolvingMetadataTitle}
          onPress={() => save()}
          style={[
            styles.saveButton,
            (!url.trim() || isSaving || isResolvingMetadataTitle) && styles.disabledButton,
          ]}
        >
          <Text style={styles.saveButtonLabel}>{isSaving ? t('common.saving') : t('common.save')}</Text>
        </Pressable>
      </View>

      {isResolvingMetadataTitle ? (
        <View pointerEvents="auto" style={styles.metadataLoadingOverlay}>
          <ActivityIndicator color={colors.surface} size="large" />
          <Text style={styles.metadataLoadingOverlayText}>{t('item.resolvingMetadataOverlay')}</Text>
        </View>
      ) : null}

      <CategoryPickerModal
        bottomInset={insets.bottom}
        collectionPool={categoryPicker.collectionPool}
        createError={categoryPicker.createError}
        error={categoryPicker.error}
        isCreateDialogVisible={categoryPicker.isCreateDialogVisible}
        isCreatingCollection={categoryPicker.isCreatingCollection}
        isLoadingMore={categoryPicker.isLoadingMore}
        isLoadingOptions={categoryPicker.isLoadingOptions}
        onClose={categoryPicker.close}
        onCloseCreateDialog={categoryPicker.closeCreateDialog}
        onCreateCollection={categoryPicker.submitNewCollection}
        onLoadMore={categoryPicker.loadMore}
        onOpenCreateDialog={categoryPicker.openCreateDialog}
        onToggle={toggleCategory}
        selectedIds={selectedCollectionIds}
        visible={categoryPicker.isVisible}
      />

      {/*
        "버리고 계속" is the data-losing action, so it takes the confirm slot's destructive style
        (matches this app's existing unsavedChanges/leave convention - see ItemDetailsScreen); "저장
        후 계속" - the safe, nothing-is-lost action - takes the cancel slot's neutral style, so an
        accidental backdrop tap or hardware back press (ConfirmDialog's dismiss falls back to
        onCancel) can never discard data by mistake.
      */}
      <ConfirmDialog
        cancelLabel={t('item.saveDraftAndContinue')}
        confirmLabel={t('item.discardDraftAndContinue')}
        message={t('item.activeDraftConflictMessage')}
        onCancel={resolveConflictWithSave}
        onConfirm={resolveConflictWithDiscard}
        title={t('item.activeDraftConflictTitle')}
        visible={pendingConflictShare !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingTop: spacing.lg,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.xs + 2,
  },
  sourceActions: {
    flexDirection: 'row',
  },
  // Icon-only, no border/background box - matches ItemDetailsScreen's identical iconButton treatment.
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  urlInput: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  memoInput: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 100,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    textAlignVertical: 'top',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: 16,
  },
  metadataResolutionFailedHint: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  // Absolutely positioned over the whole screen (a sibling of the ScrollView/bottomBar, not inside
  // either) so it covers both the fields and the Save button regardless of scroll position -
  // deliberately just a translucent backdrop plus a centered spinner/label, not a Modal: this is a
  // transient, in-place loading state for a screen already on top of the stack, not a separate
  // layer that needs its own back-button/backdrop-dismiss semantics. Same backdrop tone as
  // ConfirmDialog's own overlay for a consistent, already-established "something is blocking
  // interaction" visual language.
  metadataLoadingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  metadataLoadingOverlayText: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.md,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
    borderTopColor: colors.inputBorder,
    borderTopWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md + 4,
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
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
