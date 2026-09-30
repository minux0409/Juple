import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import { CategoryEditorDialog } from './CategoryEditorDialog';
import { CollectionTargetPickerDialog } from './CollectionTargetPickerDialog';
import { CollectionUnlockDialog } from './CollectionUnlockDialog';
import { createCollection, getCollections, type Collection } from './api/collectionsApi';
import { applyCollectionIconImageChange, type CollectionIconImageChange } from './collectionIconImage';
import { contentGateOf } from './collectionAccess';
import { DEFAULT_COLLECTION_COLOR, type CollectionColorValue } from './collectionColors';
import { DEFAULT_COLLECTION_ICON, type CollectionIconKey } from './collectionIcons';

const PAGE_LIMIT = 50;

interface CopyDestinationPickerProps {
  readonly authenticatedRequest: AuthenticatedApiRequest;
  readonly visible: boolean;
  /** The chosen Collection of the caller's own, with the grant a locked one needed (else null). */
  readonly onChosen: (destination: Collection, unlockToken: string | null) => void;
  readonly onCancel: () => void;
  /** The list could not be loaded - the picker has closed itself. */
  readonly onLoadError: () => void;
}

/**
 * Where 내 컬렉션으로 복사 puts the links: only Collections the caller OWNS (the server refuses any
 * other destination anyway), plus "+ 새 컬렉션 만들기", which creates one and chooses it at once. A
 * locked destination asks for its password first; that grant goes to the caller only, for this one
 * copy.
 */
export function CopyDestinationPicker({ authenticatedRequest, visible, onChosen, onCancel, onLoadError }: CopyDestinationPickerProps) {
  const { t } = useTranslation();
  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [unlockTarget, setUnlockTarget] = useState<Collection | null>(null);
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  useEffect(() => {
    if (!visible) {
      setUnlockTarget(null);
      setIsCreateVisible(false);
      return undefined;
    }
    let isCurrent = true;
    setIsLoading(true);
    setCollections([]);
    // Owned only - the default scope.
    getCollections(authenticatedRequest, { limit: PAGE_LIMIT })
      .then(page => {
        if (isCurrent) {
          setCollections(page.items);
          setNextCursor(page.nextCursor);
        }
      })
      .catch(() => {
        if (isCurrent) {
          onLoadErrorRef.current();
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [authenticatedRequest, visible]);

  const loadMore = () => {
    if (loadingMoreRef.current || !nextCursor || isLoading) {
      return;
    }
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    getCollections(authenticatedRequest, { limit: PAGE_LIMIT, cursor: nextCursor })
      .then(page => {
        setCollections(previous => {
          const seen = new Set(previous.map(collection => collection.id));
          return [...previous, ...page.items.filter(collection => !seen.has(collection.id))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch(() => onLoadErrorRef.current())
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  };

  const select = (destination: Collection) => {
    if (contentGateOf(destination) !== null) {
      setUnlockTarget(destination);
      return;
    }
    onChosen(destination, null);
  };

  const create = async (name: string, icon: CollectionIconKey, color: CollectionColorValue, imageChange: CollectionIconImageChange) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError(t('collections.errorNameRequired'));
      return;
    }
    if (trimmedName.length > 100) {
      setCreateError(t('collections.errorNameTooLong'));
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      let created = await createCollection(authenticatedRequest, trimmedName, icon, color);
      // Created either way; a failed photo upload only leaves the built-in icon.
      created = await applyCollectionIconImageChange(authenticatedRequest, created, imageChange).catch(() => created);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
      setIsCreateVisible(false);
      onChosen(created, null);
    } catch (caughtError) {
      setCreateError(
        caughtError instanceof ApiError && caughtError.kind === 'conflict'
          ? t('collections.errorNameConflict')
          : caughtError instanceof ApiError && caughtError.kind === 'badRequest'
            ? t('collections.errorNameInvalid')
            : t('collections.errorCreateFallback'),
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <CollectionTargetPickerDialog
        collections={collections}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        onCancel={onCancel}
        onCreateNew={() => {
          setCreateError(null);
          setIsCreateVisible(true);
        }}
        onLoadMore={loadMore}
        onSelect={select}
        title={t('collections.copyPickerTitle')}
        visible={visible && unlockTarget === null && !isCreateVisible}
      />
      <CollectionUnlockDialog
        collection={visible ? unlockTarget : null}
        onCancel={() => setUnlockTarget(null)}
        onGranted={unlockToken => {
          const destination = unlockTarget;
          setUnlockTarget(null);
          if (destination) {
            onChosen(destination, unlockToken);
          }
        }}
      />
      <CategoryEditorDialog
        error={createError}
        initialColor={DEFAULT_COLLECTION_COLOR}
        initialIcon={DEFAULT_COLLECTION_ICON}
        initialName=""
        isSubmitting={isCreating}
        mode="create"
        onCancel={() => {
          if (!isCreating) {
            setIsCreateVisible(false);
          }
        }}
        onSubmit={create}
        visible={visible && isCreateVisible}
      />
    </>
  );
}
