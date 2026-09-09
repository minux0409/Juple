import i18n from '../i18n';

/**
 * YYYY-MM-DD <-> Date conversions that only ever read/write local calendar fields - never through
 * UTC (`toISOString`, or `new Date("YYYY-MM-DD")` which parses as UTC midnight). A Purchase's
 * PurchaseDate means the calendar date the user picked, not an instant, so a UTC round-trip must
 * never be allowed to shift it by a day in timezones ahead of/behind UTC.
 */

/** Formats a Date's local calendar fields as "YYYY-MM-DD" - the save contract. */
export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses a "YYYY-MM-DD" value into a local Date at midnight - never via Date.parse/`new Date(string)`. */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Displays a "YYYY-MM-DD" value using the app's current UI language (i18n.language - ko/en, see
 * src/i18n/index.ts), not the device's raw default locale - so date formatting follows the same
 * language the rest of the UI is showing, and updates correctly if the language is ever changed
 * at runtime.
 */
export function formatDateOnlyForDisplay(value: string): string {
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
    parseDateOnly(value),
  );
}
