import { savedAtOf } from '../../lib/savedLinks';

/**
 * The 저장일 of a link's details (the one value of both the sheet and the page, own and shared links): the server's saved / added
 * instant in the viewer's locale and time zone. When the server sent none (or not a date) a plain dash stands in - never a made-up date.
 */
export function SavedAtValue({ utc, locale }: { readonly utc: string | null | undefined; readonly locale: string }) {
  const saved = savedAtOf(utc, locale);
  return saved ? <time dateTime={saved.iso}>{saved.text}</time> : <span data-saved-at-missing>{'—'}</span>;
}
