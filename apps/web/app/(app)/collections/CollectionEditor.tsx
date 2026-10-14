'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AppDictionary } from '../../../lib/appI18n';
import { COLLECTION_ICON_KEYS } from '../../../lib/collectionIconMarkup';
import {
  COLLECTION_COLOR_KEYS,
  collectionNameError,
  customColorFromHue,
  hueFromCustomColor,
  isCollectionColorKey,
  isCustomCollectionColor,
  type CollectionColorValue,
  type CollectionDraft,
  type IconImageChange,
} from '../../../lib/collectionEditor';
import { collectionTile } from '../../../lib/collectionsView';
import { CollectionGlyph } from '../Glyph';
import styles from '../app.module.css';

/** The photo types the server accepts for a Collection icon (mobile: JPEG / PNG / WebP - checked again by the server). */
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';

/**
 * The mobile CategoryEditorDialog as a page form: name, icon (or the Owner's own photo), color (preset or a custom soft hue) - the ONE
 * form of 새 컬렉션, 수정 and 내 컬렉션으로 복제, so the three never drift apart.
 * Nothing is saved until 만들기 / 저장; Cancel goes back without a change.
 */
export function CollectionEditor({
  mode,
  initial,
  initialImageUrl,
  collectionId,
  dictionary,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
  layout = 'page',
}: {
  /** create: 새 컬렉션; edit: 수정; clone: 내 컬렉션으로 복제 (a new Collection of mine started from a shared one). One form for all three. */
  readonly mode: 'create' | 'edit' | 'clone';
  readonly initial: Omit<CollectionDraft, 'image'>;
  readonly initialImageUrl: string | null;
  /** For the preview tile's fallback palette (0 for a new Collection). */
  readonly collectionId: number;
  readonly dictionary: AppDictionary;
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onSubmit: (draft: CollectionDraft) => void;
  readonly onCancel: () => void;
  /**
   * page: the preview beside the fields, actions under them (the Collections pages). dialog: ONE column inside a dialog shell - the
   * fields scroll in the dialog's body, the error and the actions stay in its foot, and there is no preview (no room for it).
   */
  readonly layout?: 'page' | 'dialog';
}) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon);
  const [color, setColor] = useState<CollectionColorValue>(initial.color);
  const [image, setImage] = useState<IconImageChange>({ kind: 'keep' });
  const [nameError, setNameError] = useState<string | null>(null);

  // A picked photo is previewed from the file itself (a local object URL, released when it changes or the form closes).
  const pickedUrl = useMemo(() => (image.kind === 'set' ? URL.createObjectURL(image.file) : null), [image]);
  useEffect(() => () => {
    if (pickedUrl) {
      URL.revokeObjectURL(pickedUrl);
    }
  }, [pickedUrl]);
  const previewImage = image.kind === 'set' ? pickedUrl : image.kind === 'remove' ? null : initialImageUrl;
  const tile = collectionTile(color, collectionId);
  const customHue = isCustomCollectionColor(color) ? hueFromCustomColor(color) : 210;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = collectionNameError(name, dictionary);
    setNameError(problem);
    if (!problem && !isSubmitting) {
      onSubmit({ name, icon, color, image });
    }
  };

  const fields = (
    <>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{dictionary.collectionNamePlaceholder}</span>
          <input
            aria-invalid={nameError ? true : undefined}
            autoFocus
            className={styles.textInput}
            dir="auto"
            maxLength={200}
            onChange={event => setName(event.target.value)}
            placeholder={dictionary.collectionNamePlaceholder}
            value={name}
          />
        </label>
        {nameError ? <p className={styles.fieldError} role="alert">{nameError}</p> : null}

        <fieldset className={styles.editorSection}>
          <legend className={styles.editorLegend}>{dictionary.collectionIconSection}</legend>
          <div className={styles.photoActions}>
            <label className={styles.settingsAction}>
              <input
                accept={PHOTO_TYPES}
                className={styles.visuallyHidden}
                disabled={isSubmitting}
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setImage({ kind: 'set', file });
                  }
                  event.target.value = '';
                }}
                type="file"
              />
              {previewImage ? dictionary.iconPhotoChange : dictionary.iconPhotoChoose}
            </label>
            {previewImage ? (
              <button className={styles.settingsAction} disabled={isSubmitting} onClick={() => setImage({ kind: 'remove' })} type="button">
                {dictionary.iconPhotoRemove}
              </button>
            ) : null}
          </div>
          <div className={styles.iconGrid} role="radiogroup">
            {COLLECTION_ICON_KEYS.map(key => (
              <button
                aria-checked={icon === key}
                aria-label={key}
                className={icon === key ? styles.iconOptionSelected : styles.iconOption}
                key={key}
                onClick={() => setIcon(key)}
                role="radio"
                style={icon === key ? { background: tile.background, color: tile.icon } : undefined}
                type="button"
              >
                <CollectionGlyph icon={key} size={22} />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.editorSection}>
          <legend className={styles.editorLegend}>{dictionary.collectionColorSection}</legend>
          <div className={styles.swatchRow} role="radiogroup">
            {COLLECTION_COLOR_KEYS.map(key => {
              const swatch = collectionTile(key, 0);
              return (
                <button
                  aria-checked={color === key}
                  aria-label={key}
                  className={color === key ? styles.swatchSelected : styles.swatch}
                  key={key}
                  onClick={() => setColor(key)}
                  role="radio"
                  style={{ background: swatch.icon }}
                  title={key}
                  type="button"
                />
              );
            })}
          </div>
          <label className={styles.hueField}>
            <span className={styles.settingsLabel}>{dictionary.customColor}</span>
            <input
              aria-valuetext={isCollectionColorKey(color) ? undefined : color}
              className={styles.hueRail}
              max={359}
              min={0}
              onChange={event => setColor(customColorFromHue(Number(event.target.value)))}
              type="range"
              value={Math.round(customHue)}
            />
          </label>
        </fieldset>
    </>
  );
  const footer = (
    <>
        {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
        <div className={styles.formActions}>
          <button className={styles.settingsAction} disabled={isSubmitting} onClick={onCancel} type="button">
            {dictionary.cancel}
          </button>
          <button className={styles.primaryAction} disabled={isSubmitting} type="submit">
            {isSubmitting ? dictionary.saving : mode === 'create' ? dictionary.collectionCreateAction : mode === 'clone' ? dictionary.cloneSubmit : dictionary.save}
          </button>
        </div>
    </>
  );

  if (layout === 'dialog') {
    return (
      <form className={styles.editorDialogForm} noValidate onSubmit={submit}>
        <div className={`${styles.dialogBody} ${styles.editorDialogFields}`}>{fields}</div>
        <div className={`${styles.formActions} ${styles.dialogFoot} ${styles.editorDialogFoot}`}>{footer}</div>
      </form>
    );
  }

  return (
    <form className={styles.editorForm} noValidate onSubmit={submit}>
      {/* What the Collection will look like - only what is chosen here (tile, color, photo, name); nothing else is invented. */}
      <aside aria-hidden className={styles.editorAside}>
        <div className={styles.collectionTile} style={{ background: tile.background, color: tile.icon, width: 112, height: 112, borderRadius: 28 }}>
          {previewImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview or the Collection's own photo
            <img alt="" src={previewImage} />
          ) : (
            <CollectionGlyph icon={icon} size={56} />
          )}
        </div>
        <p className={name.trim() ? styles.editorPreviewName : styles.editorPreviewNameEmpty} dir="auto">
          {name.trim() || dictionary.collectionNamePlaceholder}
        </p>
      </aside>
      <div className={styles.editorMain}>
        {fields}
        {footer}
      </div>
    </form>
  );
}
