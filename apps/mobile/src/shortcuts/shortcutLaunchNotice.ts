/**
 * Codes a native hand-off can leave for the app to turn into a message (see CollectionShortcutRouter). They travel as plain
 * strings through NativeIncomingShare.setShortcutNotice / consumeShortcutLaunch and must match ShareReceiverActivity.kt.
 */
export const SHORTCUT_NOTICE_TARGET_UNAVAILABLE = 'targetUnavailable';
/** A shared link was saved, but could not be put into the chosen Collection (it stopped accepting links in between). */
export const SHORTCUT_NOTICE_SAVED_WITHOUT_COLLECTION = 'savedWithoutCollection';
/** A launcher shortcut's Collection could not be opened (deleted, left, access revoked). */
export const SHORTCUT_NOTICE_OPEN_UNAVAILABLE = 'openUnavailable';

export type ShortcutNoticeCode =
  | typeof SHORTCUT_NOTICE_TARGET_UNAVAILABLE
  | typeof SHORTCUT_NOTICE_SAVED_WITHOUT_COLLECTION
  | typeof SHORTCUT_NOTICE_OPEN_UNAVAILABLE;

export function isShortcutNoticeCode(value: string | null | undefined): value is ShortcutNoticeCode {
  return value === SHORTCUT_NOTICE_TARGET_UNAVAILABLE
    || value === SHORTCUT_NOTICE_SAVED_WITHOUT_COLLECTION
    || value === SHORTCUT_NOTICE_OPEN_UNAVAILABLE;
}

/** The i18n key of the message for a notice code. */
export function shortcutNoticeMessageKey(code: ShortcutNoticeCode): string {
  switch (code) {
    case SHORTCUT_NOTICE_TARGET_UNAVAILABLE:
      return 'collections.shortcutUnavailable';
    case SHORTCUT_NOTICE_SAVED_WITHOUT_COLLECTION:
      return 'collections.shortcutSavedWithoutCollection';
    case SHORTCUT_NOTICE_OPEN_UNAVAILABLE:
      return 'collections.shortcutOpenUnavailable';
  }
}
