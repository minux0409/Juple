import type { TFunction } from 'i18next';
import { launchImageLibrary } from 'react-native-image-picker';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import {
  removeCollectionIconImage,
  setCollectionIconImage,
  type Collection,
  type CollectionIconImageAsset,
} from './api/collectionsApi';
import { forgetCollectionIcon, rememberLocalCollectionIcon } from './collectionIconImageCache';

/**
 * What the Collection editor decided about the icon photo: leave it, use a newly picked one, or go
 * back to the built-in icon. The editor never uploads anything itself - its caller applies the
 * change after the Collection exists (see applyCollectionIconImageChange).
 */
export type CollectionIconImageChange =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly asset: CollectionIconImageAsset }
  | { readonly kind: 'remove' };

export const KEEP_ICON_IMAGE: CollectionIconImageChange = { kind: 'keep' };

/**
 * An icon is at most a few dozen dp on screen, so the picker already resizes (longest edge 512px)
 * and re-encodes before anything is uploaded - a phone photo never goes up at full size.
 */
const ICON_IMAGE_MAX_EDGE = 512;
const ICON_IMAGE_QUALITY = 0.8;

export type PickedIconImage =
  | { readonly kind: 'picked'; readonly asset: CollectionIconImageAsset }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error'; readonly message: string };

export async function pickCollectionIconImage(t: TFunction): Promise<PickedIconImage> {
  try {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      includeBase64: false,
      maxWidth: ICON_IMAGE_MAX_EDGE,
      maxHeight: ICON_IMAGE_MAX_EDGE,
      quality: ICON_IMAGE_QUALITY,
      // HEIC/HEIF becomes a JPEG-compatible file the server accepts (same as Item photos).
      assetRepresentationMode: 'compatible',
    });
    if (result.didCancel) {
      return { kind: 'cancelled' };
    }
    const asset = result.assets?.[0];
    if (result.errorCode || !asset?.uri) {
      return {
        kind: 'error',
        message: result.errorCode === 'permission' ? t('item.errorImagePickerPermission') : t('item.errorImagePickerFallback'),
      };
    }
    return { kind: 'picked', asset: { uri: asset.uri, type: asset.type, fileName: asset.fileName } };
  } catch {
    return { kind: 'error', message: t('item.errorImagePickerFallback') };
  }
}

/**
 * Applies the editor's photo decision to an existing Collection; resolves with the updated
 * Collection. A new photo is shown from the file just picked (already on this device) as soon as it
 * is saved - never downloaded back first; a removed one is dropped from the image cache at once.
 */
export async function applyCollectionIconImageChange(
  request: AuthenticatedApiRequest,
  collection: Collection,
  change: CollectionIconImageChange,
): Promise<Collection> {
  if (change.kind === 'set') {
    const updated = await setCollectionIconImage(request, collection.id, change.asset);
    rememberLocalCollectionIcon(updated.id, updated.iconImageVersion, change.asset.uri);
    return updated;
  }
  if (change.kind === 'remove' && collection.iconImageUrl) {
    const updated = await removeCollectionIconImage(request, collection.id);
    forgetCollectionIcon(collection.id);
    return updated;
  }
  return collection;
}

export function getIconImageSaveErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'badRequest') {
    return t('collections.iconPhotoInvalid');
  }
  return t('collections.iconPhotoSaveFallback');
}
