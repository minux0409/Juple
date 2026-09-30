import i18n from '../../i18n';
import {
  COLLECTION_UNLOCK_HEADER,
  copyCollectionItems,
  getCollectionNotificationPreference,
  setCollectionNotificationPreference,
} from '../api/collectionsApi';
import { clearCollectionUnlockGrants, rememberCollectionUnlock } from '../collectionUnlockGrants';
import { formatCopyResultMessage } from '../copyResultMessage';
import { parseSocialPushEvent } from '../../push/pushEvents';
import { resolvePushTapNavigation } from '../../push/pushNavigation';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

describe('내 컬렉션으로 복사 / 새 링크 알림 requests', () => {
  const later = () => new Date(Date.now() + 10 * 60_000).toISOString();
  const request = jest.fn(async () => ({ status: 200, body: { copiedCount: 1, skippedCount: 0, unavailableCount: 0, newItemNotificationsEnabled: false } }));

  afterEach(() => {
    clearCollectionUnlockGrants();
    request.mockClear();
  });

  const callOf = (index: number) =>
    (request.mock.calls[index] as unknown as [{ method: string; path: string; body?: unknown; headers?: Readonly<Record<string, string>> }])[0];

  it('copies from the source into my Collection with the ids and both grants that apply', async () => {
    await copyCollectionItems(request as never, 3, [5, 6], 9);
    expect(callOf(0)).toMatchObject({
      method: 'POST',
      path: '/api/v1/collections/3/items/copy',
      body: { destinationCollectionId: 9, itemIds: [5, 6] },
    });
    expect(callOf(0).headers).toBeUndefined();

    // The source's grant of this visit (its share password) + the destination's own one-off grant.
    rememberCollectionUnlock(3, 'share-grant', later());
    await copyCollectionItems(request as never, 3, [5], 9, 'lock-grant');
    expect(callOf(1).headers).toEqual({ [COLLECTION_UNLOCK_HEADER]: 'share-grant,lock-grant' });
  });

  it('reads and writes only the caller\'s own setting', async () => {
    await getCollectionNotificationPreference(request as never, 4);
    await setCollectionNotificationPreference(request as never, 4, false);
    expect(callOf(0)).toMatchObject({ method: 'GET', path: '/api/v1/collections/4/notification-preference' });
    expect(callOf(1)).toMatchObject({
      method: 'PUT',
      path: '/api/v1/collections/4/notification-preference',
      body: { newItemNotificationsEnabled: false },
    });
  });
});

describe('copy result message', () => {
  const t = i18n.t.bind(i18n);

  it('says how many were copied, and why the rest were not', () => {
    expect(formatCopyResultMessage({ copiedCount: 5, skippedCount: 0, unavailableCount: 0 }, t)).toBe('링크 5개를 복사했어요.');
    expect(formatCopyResultMessage({ copiedCount: 4, skippedCount: 1, unavailableCount: 0 }, t)).toBe(
      '5개 중 4개를 복사했어요. 1개는 이미 컬렉션에 있어요.',
    );
    expect(formatCopyResultMessage({ copiedCount: 0, skippedCount: 1, unavailableCount: 2 }, t)).toBe(
      '3개 중 0개를 복사했어요. 1개는 이미 컬렉션에 있어요. 2개는 더 이상 이 컬렉션에 없어요.',
    );
  });
});

describe('새 링크 Push', () => {
  it('is a known event, and a tap opens that Collection', () => {
    expect(parseSocialPushEvent({ type: 'collectionItemsAdded', collectionId: '42' })).toEqual({ type: 'collectionItemsAdded', collectionId: 42 });
    expect(resolvePushTapNavigation({ type: 'collectionItemsAdded', collectionId: '42' })).toEqual({ screen: 'CollectionDetails', collectionId: 42 });
    // Without a usable Collection id there is nowhere to go.
    expect(resolvePushTapNavigation({ type: 'collectionItemsAdded', collectionId: 'x' })).toBeNull();
    expect(resolvePushTapNavigation({ type: 'collectionItemsAdded' })).toBeNull();
  });
});
