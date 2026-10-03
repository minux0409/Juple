import { bannerFromRemoteMessage, createBannerQueue, type NotificationBanner } from '../bannerQueue';

function banner(key: string): NotificationBanner {
  return { key, notificationId: null, type: 'collectionItemsAdded', title: key, body: `${key} body`, data: {} };
}

describe('banner queue - withdrawing one notification\'s banner', () => {
  const noted = (id: number): NotificationBanner => ({ key: `n:${id}`, notificationId: id, type: 'collectionLinkSubmission', title: `t${id}`, body: 'b', data: { collectionId: '7' } });

  it('removes exactly that notification: the one on screen is replaced by the next, a waiting one just leaves, others stay', () => {
    const queue = createBannerQueue(5);
    for (const id of [1, 2, 3]) {
      queue.enqueue(noted(id));
    }

    expect(queue.removeNotification(2)).toBe(true);
    expect(queue.all().map(entry => entry.notificationId)).toEqual([1, 3]);
    expect(queue.removeNotification(1)).toBe(true);
    expect(queue.current()?.notificationId).toBe(3);
    expect(queue.removeNotification(99)).toBe(false);
    expect(queue.all().map(entry => entry.notificationId)).toEqual([3]);
  });
});

describe('banner queue', () => {
  it('shows one banner at a time; the next takes its place when it leaves', () => {
    const queue = createBannerQueue(5);
    queue.enqueue(banner('a'));
    queue.enqueue(banner('b'));

    expect(queue.current()?.key).toBe('a');
    expect(queue.pendingCount()).toBe(1);
    queue.dismissCurrent();
    expect(queue.current()?.key).toBe('b');
    queue.dismissCurrent();
    expect(queue.current()).toBeNull();
  });

  it('is bounded: on overflow the oldest WAITING banner is dropped, never the one on screen', () => {
    const queue = createBannerQueue(2);
    for (const key of ['a', 'b', 'c', 'd']) {
      queue.enqueue(banner(key));
    }

    expect(queue.current()?.key).toBe('a');
    expect(queue.pendingCount()).toBe(2);
    queue.dismissCurrent();
    expect(queue.current()?.key).toBe('c');
  });

  it('ignores a notification it showed recently (a duplicate or replayed Push), within bounded memory', () => {
    const queue = createBannerQueue(5, 2);
    expect(queue.enqueue(banner('a'))).toBe(true);
    expect(queue.enqueue(banner('a'))).toBe(false);
    queue.enqueue(banner('b'));
    queue.enqueue(banner('c'));
    // 'a' has left the bounded memory - it would show again (never an unbounded history).
    expect(queue.enqueue(banner('a'))).toBe(true);
  });

  it('builds a banner only from a Push with visible text, keyed by its notification id', () => {
    expect(bannerFromRemoteMessage({ data: { type: 'collectionContentChanged' } })).toBeNull();
    expect(bannerFromRemoteMessage({ messageId: 'm', notification: { title: 'T', body: 'B' }, data: { type: 'friendRequest', notificationId: '12' } }))
      .toEqual({ key: 'n:12', notificationId: 12, type: 'friendRequest', title: 'T', body: 'B', data: { type: 'friendRequest', notificationId: '12' } });
    // An older Push: keyed by its FCM message id.
    expect(bannerFromRemoteMessage({ messageId: 'm7', notification: { title: 'T' }, data: { type: 'friendRequest' } })?.key).toBe('m:m7');
  });
});
