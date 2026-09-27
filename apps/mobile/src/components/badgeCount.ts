/** In-app count badges show 1-99, then "99+". */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}
