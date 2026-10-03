import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import type { BannerQueue } from './bannerQueue';
import { getNotification } from './notificationsApi';

/**
 * A proposal's requester cancelled it: the Owner's 승인 요청 notification was deleted on the server, so a
 * banner for it - on screen or waiting - must not announce it any more. The Collection refresh signal that
 * reaches the Owner's open app carries no notification id, so each approval-request banner of THAT
 * Collection is asked about by its own id (the Inbox's single-notification read answers 404 for a deleted
 * one) and exactly those that are gone are removed. A banner of any other kind or Collection - and an
 * approval-request banner that still exists - is never touched. Bounded: at most the few banners queued.
 */
export async function dropRetractedSubmissionBanners(
  queue: BannerQueue,
  request: AuthenticatedApiRequest,
  collectionId: number | null,
  locale: string,
): Promise<void> {
  const candidates = queue.all().filter(banner =>
    banner.type === 'collectionLinkSubmission'
    && banner.notificationId !== null
    && (collectionId === null || String(banner.data.collectionId ?? '') === String(collectionId)));
  await Promise.all(candidates.map(async banner => {
    try {
      await getNotification(request, banner.notificationId as number, locale);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
        queue.removeNotification(banner.notificationId as number);
      }
      // Any other failure (offline...): the banner stays - it is only a banner, the Inbox is the truth.
    }
  }));
}
