import { resolvePushTapNavigation } from '../pushNavigation';

describe('resolvePushTapNavigation', () => {
  it('routes to RepeatPurchaseDetails when repeatPurchaseId is present', () => {
    const target = resolvePushTapNavigation({
      type: 'repeatPurchaseDue',
      notificationId: '10',
      repeatPurchaseId: '42',
      itemId: '7',
    });

    expect(target).toEqual({ screen: 'RepeatPurchaseDetails', params: { repeatPurchaseId: 42 } });
  });

  it('accepts a numeric (not just string) repeatPurchaseId', () => {
    const target = resolvePushTapNavigation({ repeatPurchaseId: 42 });

    expect(target).toEqual({ screen: 'RepeatPurchaseDetails', params: { repeatPurchaseId: 42 } });
  });

  it('falls back to Notifications when repeatPurchaseId is absent but type is present', () => {
    const target = resolvePushTapNavigation({ type: 'repeatPurchaseDue', notificationId: '10' });

    expect(target).toEqual({ screen: 'Notifications' });
  });

  it.each([
    ['null payload', null],
    ['undefined payload', undefined],
    ['empty payload', {}],
    ['non-numeric repeatPurchaseId and no type', { repeatPurchaseId: 'not-a-number' }],
    ['zero repeatPurchaseId and no type', { repeatPurchaseId: '0' }],
    ['negative repeatPurchaseId and no type', { repeatPurchaseId: '-5' }],
    ['non-integer repeatPurchaseId and no type', { repeatPurchaseId: '4.5' }],
  ])('never throws and resolves null for %s', (_description, payload) => {
    expect(() => resolvePushTapNavigation(payload as never)).not.toThrow();
    expect(resolvePushTapNavigation(payload as never)).toBeNull();
  });

  it('ignores a malformed repeatPurchaseId and still falls back to Notifications via type', () => {
    const target = resolvePushTapNavigation({ type: 'repeatPurchaseDue', repeatPurchaseId: 'garbage' });

    expect(target).toEqual({ screen: 'Notifications' });
  });
});
