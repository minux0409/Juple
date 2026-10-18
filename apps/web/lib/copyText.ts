/**
 * Puts text on the clipboard. The async Clipboard API where the page may use it (a secure context: https or localhost); otherwise the
 * classic selection + copy command, so a plain-http development origin or a stricter browser still works. Resolves whether the text
 * is really on the clipboard - the caller reports the outcome.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof window !== 'undefined' && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused: try the fallback below.
  }
  if (typeof document === 'undefined') {
    return false;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(field);
  }
}
