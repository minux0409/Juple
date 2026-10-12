/**
 * Whether a link's Quick Detail sheet is open over another page (in-app navigation to /items/{id} is intercepted, see
 * app/(app)/@modal). While it is, the page underneath is still the person's current page - so leaving "its" address in the URL bar
 * must not end that page's visit (a Collection's unlock grant) - and 수정 / back know they came from the sheet.
 */
let overlayOpen = false;
let editOpenedFromDetails = false;

export function setItemOverlayOpen(open: boolean): void {
  overlayOpen = open;
}

export function isItemOverlayOpen(): boolean {
  return overlayOpen;
}

/** 수정 was clicked in the details (sheet or page): the editor returns by going back to them, not by navigating to them again. */
export function markEditOpenedFromDetails(): void {
  editOpenedFromDetails = true;
}

/** Read once by the editor: true only if this editor was opened from the details in this session of the page. */
export function takeEditOpenedFromDetails(): boolean {
  const value = editOpenedFromDetails;
  editOpenedFromDetails = false;
  return value;
}
