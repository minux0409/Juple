import { emitSocialPushEvent, parseSocialPushEvent, subscribeSocialPushEvents } from '../pushEvents';
import { resolvePushTapNavigation } from '../pushNavigation';
import { runWithConcurrency } from '../../collections/runWithConcurrency';
import { formatBadgeCount } from '../../components/badgeCount';

describe('social Push payloads', () => {
  it('parses only the known types, with an optional positive collection id', () => {
    expect(parseSocialPushEvent({ type: 'collectionContentChanged', collectionId: '42' })).toEqual({ type: 'collectionContentChanged', collectionId: 42, publicId: null });
    expect(parseSocialPushEvent({ type: 'friendRequest' })).toEqual({ type: 'friendRequest', collectionId: null, publicId: null });
    expect(parseSocialPushEvent({ type: 'friendRequestAnswered' })).toEqual({ type: 'friendRequestAnswered', collectionId: null, publicId: null });
    expect(parseSocialPushEvent({ type: 'collectionInvitation', collectionId: 'abc' })).toEqual({ type: 'collectionInvitation', collectionId: null, publicId: null });
    expect(parseSocialPushEvent({ type: 'repeatPurchaseDue' })).toBeNull();
    expect(parseSocialPushEvent({})).toBeNull();
    expect(parseSocialPushEvent(null)).toBeNull();
  });

  it('a tapped friend request opens Friends, a Collection invitation opens 공유 요청; refresh signals go nowhere', () => {
    expect(resolvePushTapNavigation({ type: 'friendRequest' })).toEqual({ screen: 'Friends' });
    expect(resolvePushTapNavigation({ type: 'collectionInvitation', collectionId: '3' })).toEqual({ screen: 'CollectionShareRequests' });
    expect(resolvePushTapNavigation({ type: 'collectionContentChanged' })).toBeNull();
    expect(resolvePushTapNavigation({ type: 'collectionInvitationAnswered' })).toBeNull();
    expect(resolvePushTapNavigation(undefined)).toBeNull();
  });

  it('a passed-on public link opens the public link page by its id - never the Collection itself, never a malformed id', () => {
    const publicId = 'AbCdEfGh_-0123456789abcdefghijkl';
    expect(resolvePushTapNavigation({ type: 'collectionLinkShared', publicId })).toEqual({ screen: 'SharedCollection', publicId });
    // Even if a collectionId were present, it is not where this goes.
    expect(resolvePushTapNavigation({ type: 'collectionLinkShared', publicId, collectionId: '7' })).toEqual({ screen: 'SharedCollection', publicId });
    expect(resolvePushTapNavigation({ type: 'collectionLinkShared' })).toBeNull();
    expect(resolvePushTapNavigation({ type: 'collectionLinkShared', publicId: '../evil' })).toBeNull();
    expect(resolvePushTapNavigation({ type: 'collectionLinkShared', publicId: 'short' })).toBeNull();
  });

  it('delivers foreground events to every subscriber until it unsubscribes', () => {
    const received: string[] = [];
    const unsubscribe = subscribeSocialPushEvents(event => received.push(event.type));
    emitSocialPushEvent({ type: 'friendRequest', collectionId: null, publicId: null });
    unsubscribe();
    emitSocialPushEvent({ type: 'collectionInvitation', collectionId: null, publicId: null });
    expect(received).toEqual(['friendRequest']);
  });
});

describe('runWithConcurrency', () => {
  it('never has more than the limit in flight and keeps every result in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async value => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      inFlight -= 1;
      if (value === 4) {
        throw new Error('four');
      }
      return value * 10;
    });

    expect(maxInFlight).toBe(3);
    expect(results.map(result => (result.status === 'fulfilled' ? result.value : 'failed'))).toEqual([10, 20, 30, 'failed', 50, 60, 70]);
  });

  it('handles an empty list', async () => {
    await expect(runWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });
});

describe('formatBadgeCount', () => {
  it('shows 1-99, then 99+', () => {
    expect(formatBadgeCount(1)).toBe('1');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
  });
});
