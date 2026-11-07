/**
 * The ONE text format for several links copied or shared together: the addresses in the given order, exactly one blank line between
 * two of them and no newline before the first or after the last. A single address is itself. Copy and Share both use this.
 */
export function formatLinkList(urls: readonly string[]): string {
  return urls.join('\n\n');
}
