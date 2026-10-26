import ImageEditor from '@react-native-community/image-editor';
import { outputSide, type CropRect } from './cropMath';

/** What a crop produced: an ordinary image file on this device, ready for the existing upload (setMyProfileImage ...). */
export interface CroppedImage {
  readonly uri: string;
  readonly type: string;
  readonly fileName: string;
}

const CROP_QUALITY = 0.9;

/**
 * Cuts the square `rect` (the photo's own pixels) out of the photo into a new JPEG of at most 512 px - the size the server keeps, so the
 * server's own normalization (resize, re-encode, metadata removal) finds nothing left to do but its usual work.
 *
 * The rectangle is in the photo's DISPLAYED orientation (what the person sees): on Android the library maps it back through the file's
 * EXIF orientation before decoding, and it then COPIES the file's EXIF (including orientation, GPS and camera tags) onto the cropped JPEG
 * so it displays upright; on iOS it draws the orientation-aware UIImage and writes a fresh JPEG without metadata. The server applies the
 * orientation and removes all metadata when it normalizes the upload, which is why nothing here has to strip it.
 */
export async function cropSquare(uri: string, rect: CropRect, options: { readonly maxSide?: number; readonly fileName?: string } = {}): Promise<CroppedImage> {
  const side = outputSide(rect.size, options.maxSide);
  const result = await ImageEditor.cropImage(uri, {
    offset: { x: rect.x, y: rect.y },
    size: { width: rect.size, height: rect.size },
    displaySize: { width: side, height: side },
    resizeMode: 'cover',
    format: 'jpeg',
    quality: CROP_QUALITY,
  });
  return { uri: result.uri, type: 'image/jpeg', fileName: options.fileName ?? 'profile.jpg' };
}
