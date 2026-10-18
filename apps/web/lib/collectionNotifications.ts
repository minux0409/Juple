/**
 * 새 링크 알림 On / Off of one Collection (mobile getCollectionNotificationPreference / setCollectionNotificationPreference, on the
 * existing API - nothing new on the server). The caller's own setting for a Collection they own or belong to; ON by default.
 */
export interface CollectionNotificationPreference {
  readonly newItemNotificationsEnabled: boolean;
}

export function collectionNotificationPreferencePath(collectionId: number): string {
  return `/api/v1/collections/${collectionId}/notification-preference`;
}
