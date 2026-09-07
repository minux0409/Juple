import { consumePendingPushTarget, setPendingPushTarget } from '../pendingPushTarget';

describe('pendingPushTarget', () => {
  afterEach(() => {
    // Clears any leftover slot between tests - the module holds one shared in-memory value.
    consumePendingPushTarget();
  });

  it('returns null when nothing is pending', () => {
    expect(consumePendingPushTarget()).toBeNull();
  });

  it('returns what was set, then clears it on consumption', () => {
    const payload = { repeatPurchaseId: '5' };
    setPendingPushTarget(payload);

    expect(consumePendingPushTarget()).toBe(payload);
    expect(consumePendingPushTarget()).toBeNull();
  });

  it('a second set replaces the first before either is consumed', () => {
    setPendingPushTarget({ repeatPurchaseId: '1' });
    setPendingPushTarget({ repeatPurchaseId: '2' });

    expect(consumePendingPushTarget()).toEqual({ repeatPurchaseId: '2' });
  });

  it('setting null clears a previously pending payload', () => {
    setPendingPushTarget({ repeatPurchaseId: '1' });
    setPendingPushTarget(null);

    expect(consumePendingPushTarget()).toBeNull();
  });
});
