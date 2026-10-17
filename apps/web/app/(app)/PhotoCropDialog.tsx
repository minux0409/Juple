'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  coverScale,
  cropRect,
  distance,
  initialView,
  outputSide,
  panBy,
  zoomTo,
  type CropView,
} from '../../lib/imageCrop';
import { useSignedInApp } from './AppRoot';
import { Modal } from './Modal';
import { useObjectUrl } from './useObjectUrl';
import styles from './app.module.css';

/** The square the person moves the photo under (CSS: .cropViewport) - small enough for a 320px-wide phone inside the dialog. */
const VIEWPORT = 240;
const PREVIEW = 72;
const KEY_STEP = 12;
const ZOOM_STEP = 0.2;

/**
 * A square photo crop in a dialog: the photo can be dragged (mouse, touch, arrow keys) and zoomed (slider, wheel, pinch, + / -), the
 * crop area is the whole square and a circle shows how it will be displayed, with a small live preview. Nothing leaves the browser
 * here: Apply draws exactly the square that is shown onto a canvas and hands back an ordinary image File (JPEG, at most 512 px, no
 * metadata - a canvas carries none), which the caller then uploads through the existing photo flow; Cancel hands back nothing.
 * Generic on purpose (a File in, a File out): a Collection cover can use it later.
 */
export function PhotoCropDialog({
  file,
  onApply,
  onCancel,
}: {
  /** The picked photo; null = closed. */
  readonly file: File | null;
  readonly onApply: (cropped: File) => void;
  readonly onCancel: () => void;
}) {
  const { dictionary } = useSignedInApp();
  return (
    <Modal closeLabel={dictionary.cancel} onClose={onCancel} open={file !== null} title={dictionary.profileCropTitle}>
      {file ? <CropBody file={file} key={`${file.name}:${file.size}:${file.lastModified}`} onApply={onApply} onCancel={onCancel} /> : null}
    </Modal>
  );
}

function CropBody({ file, onApply, onCancel }: { readonly file: File; readonly onApply: (cropped: File) => void; readonly onCancel: () => void }) {
  const { dictionary } = useSignedInApp();
  const url = useObjectUrl(file) ?? '';
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null);
  const [view, setView] = useState<CropView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  const onLoad = () => {
    const image = imageRef.current;
    if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
      const next = { width: image.naturalWidth, height: image.naturalHeight };
      setSize(next);
      setView(initialView(next.width, next.height, VIEWPORT));
    } else {
      setFailed(true);
    }
  };

  const update = useCallback(
    (change: (current: CropView, width: number, height: number) => CropView) => {
      if (!size) {
        return;
      }
      setView(current => (current ? change(current, size.width, size.height) : current));
    },
    [size],
  );

  // The wheel must be able to stop the page from scrolling: React's wheel handler is passive, so it is attached here.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element || !size) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const focus = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      update((current, width, height) => zoomTo(current, current.zoom * Math.exp(-event.deltaY * 0.002), width, height, VIEWPORT, focus));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [size, update]);

  const localPoint = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPoint(event));
    if (pointers.current.size === 2 && view) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { distance: distance(a, b), zoom: view.zoom };
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) {
      return;
    }
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const start = pinchStart.current;
      const focus = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      update((current, width, height) => zoomTo(current, start.zoom * (distance(a, b) / Math.max(1, start.distance)), width, height, VIEWPORT, focus));
      return;
    }
    update((current, width, height) => panBy(current, point.x - previous.x, point.y - previous.y, width, height, VIEWPORT));
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      pinchStart.current = null;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = (dx: number, dy: number) => {
      event.preventDefault();
      update((current, width, height) => panBy(current, dx, dy, width, height, VIEWPORT));
    };
    const zoom = (delta: number) => {
      event.preventDefault();
      update((current, width, height) => zoomTo(current, current.zoom + delta, width, height, VIEWPORT));
    };
    switch (event.key) {
      case 'ArrowLeft':
        move(KEY_STEP, 0);
        break;
      case 'ArrowRight':
        move(-KEY_STEP, 0);
        break;
      case 'ArrowUp':
        move(0, KEY_STEP);
        break;
      case 'ArrowDown':
        move(0, -KEY_STEP);
        break;
      case '+':
      case '=':
        zoom(ZOOM_STEP);
        break;
      case '-':
        zoom(-ZOOM_STEP);
        break;
      default:
    }
  };

  const apply = () => {
    const image = imageRef.current;
    if (busyRef.current || !image || !size || !view) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const rect = cropRect(view, size.width, size.height, VIEWPORT);
    const side = outputSide(rect.size);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) {
      busyRef.current = false;
      setBusy(false);
      setFailed(true);
      return;
    }
    // A transparent PNG would turn black in a JPEG: lay it on white first.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, side, side);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, side, side);
    canvas.toBlob(
      blob => {
        busyRef.current = false;
        setBusy(false);
        if (!blob) {
          setFailed(true);
          return;
        }
        onApply(new File([blob], 'profile.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
      },
      'image/jpeg',
      0.92,
    );
  };

  const scale = size && view ? coverScale(size.width, size.height, VIEWPORT) * view.zoom : 1;
  const imageStyle = (ratio: number) =>
    size && view
      ? { width: size.width * scale * ratio, height: size.height * scale * ratio, transform: `translate(${view.x * ratio}px, ${view.y * ratio}px)` }
      : { width: 0, height: 0 };

  return (
    <div className={styles.cropBody} data-photo-crop>
      <p className={styles.cropHint}>{dictionary.profileCropHint}</p>
      <div
        aria-label={dictionary.profileCropAreaA11y}
        className={styles.cropViewport}
        onKeyDown={onKeyDown}
        onPointerCancel={onPointerEnd}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        ref={viewportRef}
        role="group"
        tabIndex={0}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, positioned by the crop maths */}
        <img alt="" className={styles.cropImage} draggable={false} onError={() => setFailed(true)} onLoad={onLoad} ref={imageRef} src={url} style={imageStyle(1)} />
        <span aria-hidden className={styles.cropMask} />
      </div>
      <div className={styles.cropControls}>
        <label className={styles.cropZoom}>
          <span>{dictionary.profileCropZoom}</span>
          <input
            aria-label={dictionary.profileCropZoom}
            disabled={!size}
            max={MAX_ZOOM}
            min={MIN_ZOOM}
            onChange={event => update((current, width, height) => zoomTo(current, Number(event.target.value), width, height, VIEWPORT))}
            step={0.01}
            type="range"
            value={view?.zoom ?? MIN_ZOOM}
          />
        </label>
        <div aria-label={dictionary.profileCropPreview} className={styles.cropPreview} role="img">
          <div className={styles.cropPreviewCircle} style={{ width: PREVIEW, height: PREVIEW }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the same local photo, scaled */}
            <img alt="" className={styles.cropImage} draggable={false} src={url} style={imageStyle(PREVIEW / VIEWPORT)} />
          </div>
        </div>
      </div>
      <p className={styles.cropNote}>{dictionary.profileCropNote}</p>
      {failed ? (
        <p className={styles.fieldError} role="alert">
          {dictionary.profilePhotoInvalid}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <button className={styles.settingsAction} disabled={busy} onClick={onCancel} type="button">
          {dictionary.cancel}
        </button>
        <button className={styles.primaryAction} data-photo-crop-apply disabled={busy || !view || failed} onClick={apply} type="button">
          {busy ? dictionary.processing : dictionary.profileCropApply}
        </button>
      </div>
    </div>
  );
}
