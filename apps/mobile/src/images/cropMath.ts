/**
 * The geometry of a square photo crop - pure, so it is tested without a device. Same rules as the Web (apps/web/lib/imageCrop.ts). The
 * photo is shown inside a square viewport. At zoom 1 it just COVERS the viewport (its shorter side equals the viewport - never an empty
 * strip); zooming in enlarges it; the photo can be moved, but never so far that the viewport shows anything outside it. The result is the
 * square, in the photo's own pixels, that the viewport shows.
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** The server keeps a profile photo at 512 px at most (and re-encodes it), so a crop is never exported larger than that. */
export const CROP_OUTPUT_MAX = 512;

/** zoom, and where the photo's top-left corner is inside the viewport (viewport pixels; 0 or negative). */
export interface CropView {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Display pixels per photo pixel at zoom 1. */
export function coverScale(imageWidth: number, imageHeight: number, viewport: number): number {
  return viewport / Math.min(imageWidth, imageHeight);
}

/** Nearest valid view: zoom within limits, the photo covering the whole viewport. */
export function clampView(view: CropView, imageWidth: number, imageHeight: number, viewport: number): CropView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(view.zoom) ? view.zoom : MIN_ZOOM));
  const scale = coverScale(imageWidth, imageHeight, viewport) * zoom;
  const minX = Math.min(0, viewport - imageWidth * scale);
  const minY = Math.min(0, viewport - imageHeight * scale);
  return { zoom, x: Math.min(0, Math.max(minX, view.x)), y: Math.min(0, Math.max(minY, view.y)) };
}

/** Centered, at zoom 1. */
export function initialView(imageWidth: number, imageHeight: number, viewport: number): CropView {
  const scale = coverScale(imageWidth, imageHeight, viewport);
  return clampView({ zoom: MIN_ZOOM, x: (viewport - imageWidth * scale) / 2, y: (viewport - imageHeight * scale) / 2 }, imageWidth, imageHeight, viewport);
}

/** Moves the photo by a drag, within bounds. */
export function panBy(view: CropView, dx: number, dy: number, imageWidth: number, imageHeight: number, viewport: number): CropView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, imageWidth, imageHeight, viewport);
}

/** Changes the zoom keeping the photo point under `focus` (viewport pixels; the centre by default) where it is. */
export function zoomTo(
  view: CropView,
  nextZoom: number,
  imageWidth: number,
  imageHeight: number,
  viewport: number,
  focus: { readonly x: number; readonly y: number } = { x: viewport / 2, y: viewport / 2 },
): CropView {
  const base = coverScale(imageWidth, imageHeight, viewport);
  const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const oldScale = base * view.zoom;
  const newScale = base * clampedZoom;
  // the photo coordinate under the focus stays under it
  const photoX = (focus.x - view.x) / oldScale;
  const photoY = (focus.y - view.y) / oldScale;
  return clampView({ zoom: clampedZoom, x: focus.x - photoX * newScale, y: focus.y - photoY * newScale }, imageWidth, imageHeight, viewport);
}

/** The square (photo pixels) the viewport shows, whole pixels inside the photo. */
export function cropRect(view: CropView, imageWidth: number, imageHeight: number, viewport: number): CropRect {
  const v = clampView(view, imageWidth, imageHeight, viewport);
  const scale = coverScale(imageWidth, imageHeight, viewport) * v.zoom;
  const size = Math.min(Math.round(viewport / scale), imageWidth, imageHeight);
  const x = Math.min(imageWidth - size, Math.max(0, Math.round(-v.x / scale)));
  const y = Math.min(imageHeight - size, Math.max(0, Math.round(-v.y / scale)));
  return { x, y, size };
}

/** The exported side: the crop's own size, never enlarged, never above what the server keeps. */
export function outputSide(cropSize: number, maxSide: number = CROP_OUTPUT_MAX): number {
  return Math.max(1, Math.min(cropSize, maxSide));
}

export function distance(a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
