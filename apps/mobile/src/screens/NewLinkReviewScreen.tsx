import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// react-native-get-random-values is imported once at the app entry point before anything else can
// call uuid - see pushInstallationId.ts's own remarks on why uuid would otherwise silently fall
// back to a non-cryptographic Math.random() on Hermes.
import { v4 as uuidv4 } from 'uuid';
import { ApiError } from '../api/ApiError';
import { formatSaveOutcomeMessage, needsSaveOutcomeDialog } from '../collections/saveOutcomeMessage';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import type { Collection } from '../collections/api/collectionsApi';
import { useCategoryPickerModal } from '../collections/useCategoryPickerModal';
import { CategoryEditorDialog } from '../collections/CategoryEditorDialog';
import { CollectionUnlockDialog } from '../collections/CollectionUnlockDialog';
import { DEFAULT_COLLECTION_COLOR } from '../collections/collectionColors';
import { DEFAULT_COLLECTION_ICON } from '../collections/collectionIcons';
import { CollectionChoiceGrid } from '../collections/CollectionChoiceGrid';
import { needsUnlockForContent } from '../collections/collectionAccess';
import { SourceRow } from '../components/SourceRow';
import { LinkIcon } from '../icons/LinkIcon';
import { SiteIcon } from '../icons/SiteIcon';
import { saveInboxEntryToCollections } from '../inbox/api/inboxApi';
import { COLLECTION_SHARE_URL_NOT_SAVABLE_CODE, parseCollectionShareUrl, publicIdFromServerVerifiedShareUrl } from '../share/collectionShareUrl';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useMessageDialog } from '../components/useMessageDialog';
import { setItemPreviewImage, updateItemDetails } from '../items/api/itemsApi';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import type { RootStackParamList } from '../navigation/RootStack';
import { registerActiveNewLinkReviewDraft, clearActiveNewLinkReviewDraft } from '../share/activeNewLinkReviewDraft';
import { isHttpUrl, normalizeShareTextForComparison, resolveIncomingShare } from '../share/resolveIncomingShare';
import type { PendingShare } from '../share/specs/NativeIncomingShare';
import { useIncomingShare } from '../share/useIncomingShare';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { resolveUrlMetadata } from '../urlMetadata/api/urlMetadataApi';
import {
  applyInstagramDeviceFallback,
  needsInstagramDeviceFallback,
  previewInstagramDeviceFallback,
  type KnownMetadata,
} from '../urlMetadata/instagramDeviceFallback';
import { fetchInstagramOpenGraphCandidate, type InstagramOpenGraphFetchResult } from '../urlMetadata/instagramOpenGraphFetch';
import { KeyboardSafeView } from '../components/KeyboardSafeView';


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

export function NewLinkReviewScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();

  const { acknowledgePendingShare } = useIncomingShare();

  const [url] = useState(route.params.url);
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

  const [isSaving, setIsSaving] = useState(false);
  // What a save (or a photo pick, or opening the link) did when it was not a plain success - and the
  // result of a save that proposed the link to 승인 후 추가 Collections - in the shared message dialog,
  // never a red line under the Save button that the keyboard can hide. Whatever should follow a
  // finished save (leaving the screen) waits for its 확인; a failed save keeps every draft as typed.
  const { showMessage, messageDialog } = useMessageDialog();

  const [isResolvingMetadataTitle, setIsResolvingMetadataTitle] = useState(false);
  // Set only when the metadata fetch itself throws (network/timeout/server error) - never for a
  // clean resolution that simply found no title/image, which is not a failure worth surfacing.
  // Shown as a small, non-blocking hint once resolution finishes; never re-blocks Save.
  const [metadataResolutionFailed, setMetadataResolutionFailed] = useState(false);
  // Set only by the user actually typing in the title field (see handleTitleChange) - never by
  // the metadata auto-fill below - so a later-arriving metadata result can tell "the user started
  // typing" apart from "the field is still exactly what it started as".

  // The same mount-time metadata fetch also resolves a preview image - shown here (unlike before,
  // where it was only silently captured in a ref and applied after Save with no UI at all) so the
  // user can see what will be saved as the auto image before Save even runs. There is no Item yet
  // while this screen is open, so this - and any staged photo below - only become real server
  // state at Save time (see save()). Never blocks Save itself; a still-pending/failed resolve just
  // means no auto image is shown/applied.
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  // The new Item's one photo (대표 사진), picked here and uploaded only at Save - never before, as
  // there is no Item yet. Shown ahead of the automatic preview above; null = none picked.
  const previewImageUrlRef = useRef(previewImageUrl);
  useEffect(() => {
    previewImageUrlRef.current = previewImageUrl;
  }, [previewImageUrl]);
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
  }, []);

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
  // Instagram device fallback (see instagramDeviceFallback.ts): started at most once, in the
  // background while the user is still reviewing, and only when the Backend's resolve below left the
  // title or image missing. The raw result is never rendered: it is shown only after the Backend's
  // preview endpoint normalized it (same rules as the Item-scoped candidate endpoint), and Save hands
  // the same fetch to that Item-scoped endpoint for the saved Item - never a second fetch.
  const instagramDeviceFetchRef = useRef<Promise<InstagramOpenGraphFetchResult> | null>(null);
  // True while previewImageUrl came from the device fallback rather than the Backend's own resolve -
  // Save then leaves that image to the Item-scoped candidate endpoint (which re-validates it) instead
  // of writing it through setItemPreviewImage.
  const isPreviewImageFromInstagramDeviceRef = useRef(false);
  const startInstagramDeviceFetchIfNeeded = (
    known: KnownMetadata,
    backendMetadata: KnownMetadata,
    isActive: () => boolean,
  ) => {
    if (instagramDeviceFetchRef.current !== null || !needsInstagramDeviceFallback(route.params.url, known)) {
      return;
    }
    const pendingFetch = fetchInstagramOpenGraphCandidate(route.params.url);
    instagramDeviceFetchRef.current = pendingFetch;

    // Pre-save display. Precedence is unchanged: the user's own title edit or staged photo always
    // wins, and a real Backend title/image is never replaced - the device preview only fills what
    // the Backend left missing (it may still replace the share-provided initialTitle, exactly like a
    // Backend title would). Ignored if the screen unmounted or the URL was edited since the fetch
    // started (the fetch was for route.params.url, not whatever the field holds now). Every failure
    // is silent: previewInstagramDeviceFallback never throws and returns null for nothing usable.
    previewInstagramDeviceFallback(authenticatedRequest, route.params.url, pendingFetch).then(preview => {
      if (!preview || !isActive() || urlRef.current.trim() !== route.params.url.trim()) {
        return;
      }
      if (preview.title && !backendMetadata.hasTitle) {
        setTitle(preview.title);
      }
      if (
        preview.previewImageUrl
        && !backendMetadata.hasImage
        && !previewImageUrlRef.current
      ) {
        isPreviewImageFromInstagramDeviceRef.current = true;
        setPreviewImageUrl(preview.previewImageUrl);
      }
    });
  };

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
        const hasBackendTitle =
          Boolean(metadata.title) && !isKnownYouTubePlaceholderTitle(route.params.url, metadata.title ?? '');
        startInstagramDeviceFetchIfNeeded(
          {
            hasTitle: Boolean(route.params.initialTitle) || hasBackendTitle,
            hasImage: Boolean(metadata.previewImageUrl),
          },
          { hasTitle: hasBackendTitle, hasImage: Boolean(metadata.previewImageUrl) },
          () => isMounted,
        );
        // Skipped entirely once the user has already picked their own photo - picking one from the
        // OS library realistically takes longer than this network round-trip, so a late-arriving
        // automatic image is a real race, not a hypothetical one.
        if (metadata.previewImageUrl) {
          setPreviewImageUrl(metadata.previewImageUrl);
        }
        // A known YouTube placeholder (see isKnownYouTubePlaceholderTitle) is treated exactly like
        // "no title" here - title simply stays whatever it already was (the share-provided
        // initialTitle, or empty), never the placeholder itself.
        if (
          !metadata.title
          || isKnownYouTubePlaceholderTitle(route.params.url, metadata.title)
        ) {
          return;
        }
        setTitle(metadata.title);
      })
      .catch(() => {
        if (isMounted) {
          setMetadataResolutionFailed(true);
          startInstagramDeviceFetchIfNeeded(
            { hasTitle: Boolean(route.params.initialTitle), hasImage: false },
            { hasTitle: false, hasImage: false },
            () => isMounted,
          );
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

  // The new link goes to the Collections chosen here - any number of them (Item ↔ Collection is many-to-many), or
  // explicitly none. Nothing is chosen on arrival: Save waits for a deliberate decision.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [isNoneChosen, setIsNoneChosen] = useState(false);
  const hasDestinationDecision = isNoneChosen || selectedIds.size > 0;

  const check = (collectionId: number) => {
    setIsNoneChosen(false);
    setSelectedIds(previous => new Set(previous).add(collectionId));
  };

  // A Collection made here is checked at once, next to whatever was already checked; the link, its preview and the
  // memo draft are untouched (this screen never leaves for the create dialog).
  const categoryPicker = useCategoryPickerModal(authenticatedRequest, t, created => check(created.id));
  useEffect(() => {
    if (categoryPicker.error) { showMessage(categoryPicker.error); }
  }, [categoryPicker.error, showMessage]);
  useEffect(() => {
    categoryPicker.open();
    // The destination list is loaded once on arrival; retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A share aimed at one Collection (a direct-share shortcut) starts with it checked - once its card is known, and only
  // when it is not locked (a locked one is checked by tapping it, which asks for its password first).
  const preselectedAppliedRef = useRef(false);
  useEffect(() => {
    const preselectedId = route.params.preselectedCollectionId;
    if (preselectedAppliedRef.current || preselectedId === null) {
      return;
    }
    const preselected = categoryPicker.collectionPool.find(option => option.id === preselectedId);
    if (preselected) {
      preselectedAppliedRef.current = true;
      if (!needsUnlockForContent(preselected)) {
        check(preselected.id);
      }
    }
  }, [categoryPicker.collectionPool, route.params.preselectedCollectionId]);

  const toggleCollection = (option: Collection) => {
    if (selectedIds.has(option.id)) {
      // Unchecking changes nothing on the server yet - no password is needed for it.
      setSelectedIds(previous => {
        const next = new Set(previous);
        next.delete(option.id);
        return next;
      });
      return;
    }
    // Checking reads the Collection's CURRENT state first (never the list snapshot): locked now → its password;
    // unlocked meanwhile → checked at once without a stale prompt.
    categoryPicker.requestToggle(option, () => check(option.id), true);
  };

  const chooseNone = () => {
    setIsNoneChosen(true);
    setSelectedIds(new Set());
  };

  // onSuccess defaults to the plain "go back to whatever opened this screen" behavior; the active-draft conflict flow
  // below passes its own onSuccess (acknowledge the pending share + replace this screen with a fresh one for the new
  // URL) so it reuses this exact same save. The `isSaving` guard makes a second concurrent call a no-op.
  const save = async (onSuccess: () => void = () => navigation.goBack()) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || isSaving || !hasDestinationDecision) {
      return;
    }

    // A Juple Collection share link is never saved as an ordinary link - it opens the Collection.
    const sharedCollectionId = parseCollectionShareUrl(trimmedUrl);
    if (sharedCollectionId !== null) {
      navigation.replace('SharedCollection', { publicId: sharedCollectionId });
      return;
    }

    // Stable across a retry of this exact url (so the server replays the already-created Item instead of creating a
    // duplicate), regenerated only if the url itself changed since the last attempt.
    if (clientRequestIdRef.current === null || clientRequestUrlRef.current !== trimmedUrl) {
      clientRequestIdRef.current = uuidv4();
      clientRequestUrlRef.current = trimmedUrl;
    }

    setIsSaving(true);
    try {
      // ONE request for the link and every chosen Collection: the server checks all of them before writing anything and
      // writes the memberships together (see saveInboxEntryToCollections) - never one follow-up request per Collection.
      const collectionIds = isNoneChosen ? [] : [...selectedIds];
      const unlockTokens: Record<number, string> = {};
      for (const collectionId of collectionIds) {
        const token = categoryPicker.unlockTokenFor(collectionId);
        if (token) {
          unlockTokens[collectionId] = token;
        }
      }
      const savedEntry = await saveInboxEntryToCollections(authenticatedRequest, trimmedUrl, clientRequestIdRef.current, collectionIds, unlockTokens);

      const trimmedTitle = title.trim();
      const trimmedMemo = memo.trim();
      if (trimmedTitle || trimmedMemo) {
        await updateItemDetails(authenticatedRequest, savedEntry.id, {
          title: trimmedTitle,
          memo: trimmedMemo,
        });
      }

      // Best-effort, from the same mount-time metadata fetch the title above already used - never blocks/fails Save
      // itself, but still AWAITED before navigating back, so Home's refetch on focus sees it already committed. A
      // device-fallback image is left to the Instagram candidate step just below instead.
      if (previewImageUrl && !isPreviewImageFromInstagramDeviceRef.current) {
        await setItemPreviewImage(authenticatedRequest, savedEntry.id, previewImageUrl).catch(() => undefined);
      }

      // Instagram device fallback for the just-saved Item - reuses the fetch started during review (never a second
      // one), only for the same URL that fetch was for. Never throws; the Backend applies it only to still-empty
      // automatic fields, so the title saved just above wins.
      const pendingInstagramFetch = instagramDeviceFetchRef.current;
      if (pendingInstagramFetch && trimmedUrl === route.params.url.trim()) {
        await applyInstagramDeviceFallback(authenticatedRequest, savedEntry.id, trimmedUrl, pendingInstagramFetch);
      }

      const saveOutcome = {
        added: savedEntry.addedCount,
        submitted: savedEntry.submittedCount,
        alreadyPending: savedEntry.alreadyPendingCount,
        alreadyInCollection: savedEntry.alreadyInCollectionCount,
      };
      if (needsSaveOutcomeDialog(saveOutcome)) {
        showMessage(formatSaveOutcomeMessage(saveOutcome, t), {
          title: saveOutcome.submitted > 0 ? t('collections.saveOutcomeTitle') : undefined,
          onDone: onSuccess,
        });
      } else {
        onSuccess();
      }
    } catch (caughtError) {
      // The server's own invariant (an older navigation state, a race, a build that does not know the public host):
      // a Collection share link is never saved - open the Collection when its id is in the URL, else say why.
      if (caughtError instanceof ApiError && caughtError.kind === 'badRequest' && caughtError.code === COLLECTION_SHARE_URL_NOT_SAVABLE_CODE) {
        const sharedPublicId = publicIdFromServerVerifiedShareUrl(trimmedUrl);
        if (sharedPublicId !== null) {
          navigation.replace('SharedCollection', { publicId: sharedPublicId });
        } else {
          showMessage(t('item.collectionLinkNotSavable'));
        }
        return;
      }
      showMessage(getSaveErrorMessage(caughtError, t));
    } finally {
      setIsSaving(false);
    }
  };

  // Hands the now-resolved conflict share off to a brand-new NewLinkReview instance - navigation.replace (not
  // navigate) always creates a fresh route with a new key, which remounts this screen with clean state.
  // acknowledgePendingShare only happens here, once the hand-off is actually committed - never earlier, so a save
  // failure (see resolveConflictWithSave) never loses the pending share.
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

  // "저장 후 계속" - the exact same save() the main Save button uses, with a different onSuccess. On failure save()
  // already shows why and pendingConflictShare stays, so the user can retry either button.
  const resolveConflictWithSave = () => {
    if (!pendingConflictShare) {
      return;
    }
    const share = pendingConflictShare;
    save(() => completeConflictHandoff(share));
  };

  // "버리고 계속" - never calls save(); the current draft (nothing persisted) is simply abandoned.
  const resolveConflictWithDiscard = () => {
    if (!pendingConflictShare) {
      return;
    }
    completeConflictHandoff(pendingConflictShare);
  };

  const site = resolveSiteInfo(url);
  const isSaveDisabled = !hasDestinationDecision || !url.trim() || isSaving;

  return (
    <KeyboardSafeView style={styles.screen} testID="new-link-review">
      {/* What is being saved: compact, read-only (advanced editing belongs to the link's own details later). */}
      <View style={styles.preview} testID="save-link-preview">
        {previewImageUrl ? (
          <Image source={{ uri: previewImageUrl }} style={styles.thumbnail} testID="save-link-thumbnail" />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailFallback]}>
            {site.id ? <SiteIcon siteId={site.id} size={26} /> : <LinkIcon color={colors.brand} size={24} />}
          </View>
        )}
        <View style={styles.previewText}>
          <Text numberOfLines={2} style={styles.previewTitle} testID="save-link-title">{title.trim() || site.label || url}</Text>
          <SourceRow url={url} />
          {isResolvingMetadataTitle ? <ActivityIndicator size="small" style={styles.previewLoading} testID="save-link-resolving" /> : null}
          {!isResolvingMetadataTitle && metadataResolutionFailed ? (
            <Text style={styles.metadataResolutionFailedHint}>{t('item.metadataResolutionFailedHint')}</Text>
          ) : null}
        </View>
      </View>

      {/* Where to: the same 컬렉션 선택 chooser as everywhere else in Juple, filling the room between the preview and the
          composer (its own list scrolls), led by [+ 새로 만들기] [선택 안 함]. */}
      <View style={styles.destinations} testID="save-destination-list">
        <CollectionChoiceGrid
          collectionPool={categoryPicker.collectionPool}
          isLoadingMore={categoryPicker.isLoadingMore}
          isLoadingOptions={categoryPicker.isLoadingOptions}
          listStyle={styles.destinationList}
          loadFailure={categoryPicker.loadFailure}
          noneTile={{ label: t('quickSaveComposer.categoryNone'), isSelected: isNoneChosen, onPress: chooseNone }}
          onLoadMore={categoryPicker.loadMore}
          onOpenCreateDialog={categoryPicker.openCreateDialog}
          onRetryLoad={categoryPicker.retryLoad}
          onToggle={toggleCollection}
          selectedIds={selectedIds}
          viewModeKey="categoryPickerViewMode"
        />
      </View>

      {/* Sticky composer: the optional memo opens once a destination is decided; Save is always visible above the
          keyboard (KeyboardSafeView) and the system navigation bar. */}
      <View style={[styles.bottomBar, { paddingBottom: spacing.md + insets.bottom }]}>
        {hasDestinationDecision ? (
          <TextInput
            accessibilityLabel={t('item.memoPlaceholder')}
            editable={!isSaving}
            multiline
            onChangeText={setMemo}
            placeholder={t('item.memoPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            scrollEnabled
            style={styles.memoInput}
            testID="save-memo-composer"
            value={memo}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSaveDisabled, busy: isSaving }}
          disabled={isSaveDisabled}
          onPress={() => save()}
          style={[styles.saveButton, isSaveDisabled && styles.disabledButton]}
          testID="new-link-review-save"
        >
          {isSaving ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.saveButtonLabel}>{t('common.save')}</Text>}
        </Pressable>
      </View>

      {categoryPicker.isCreateDialogVisible ? <CategoryEditorDialog
        error={categoryPicker.createError} initialColor={DEFAULT_COLLECTION_COLOR} initialIcon={DEFAULT_COLLECTION_ICON}
        initialName="" isSubmitting={categoryPicker.isCreatingCollection} mode="create"
        onCancel={categoryPicker.closeCreateDialog} onSubmit={categoryPicker.submitNewCollection} visible
      /> : null}
      {categoryPicker.unlockTarget ? <CollectionUnlockDialog collection={categoryPicker.unlockTarget} onCancel={categoryPicker.cancelUnlock}
        onGranted={categoryPicker.onUnlockGranted} onStateChanged={categoryPicker.onUnlockStateChanged} /> : null}
      <ConfirmDialog cancelLabel={t('item.saveDraftAndContinue')}
        confirmLabel={t('item.discardDraftAndContinue')} message={t('item.activeDraftConflictMessage')}
        onCancel={resolveConflictWithSave} onConfirm={resolveConflictWithDiscard}
        title={t('item.activeDraftConflictTitle')} visible={pendingConflictShare !== null} />
      {messageDialog}
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  preview: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  thumbnail: { borderRadius: radii.md, height: 64, width: 64 },
  thumbnailFallback: { alignItems: 'center', backgroundColor: colors.surfaceMuted, justifyContent: 'center' },
  previewText: { flex: 1, minWidth: 0 },
  previewTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', lineHeight: 20, marginBottom: 2 },
  previewLoading: { alignSelf: 'flex-start', marginTop: spacing.xs },
  metadataResolutionFailedHint: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },
  // Takes the room between the preview and the composer; the chooser's own list scrolls inside it.
  destinations: { flex: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  destinationList: { flex: 1 },
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.inputBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  memoInput: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    // Bounded like a message composer: a few lines, then it scrolls inside - never pushes Save off a short screen.
    maxHeight: 120,
    minHeight: 48,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    textAlignVertical: 'top',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md + 4,
    justifyContent: 'center',
    minHeight: minTouchTarget + 4,
    paddingVertical: spacing.sm,
  },
  saveButtonLabel: { color: colors.surface, fontSize: 16, fontWeight: '600' },
  disabledButton: { opacity: 0.5 },
});
