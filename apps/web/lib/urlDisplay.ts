/** Best-effort hostname for display only (e.g. "shop.example.com") - never used for navigation or validation. */
export function getDisplayDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
