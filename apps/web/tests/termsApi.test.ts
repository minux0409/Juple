import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ApiHttpError, type AppApi } from '../lib/appApi.ts';
import { createTermsAwareApi } from '../lib/termsApi.ts';
import { requiresTermsAcceptance, type TermsStatus } from '../lib/safety.ts';

for (const enforceAcceptance of [false, true]) {
  it(`refreshes real enforcement after a purchase refusal: enforce=${enforceAcceptance}`, async () => {
    const calls: string[] = [];
    const original = new ApiHttpError(403, 'termsAcceptanceRequired');
    const raw: AppApi = async <T>(request: { path: string }): Promise<T> => {
      calls.push(request.path);
      if (request.path.endsWith('/terms')) return { currentVersion: '2026-10-14', acceptedVersion: null, isAccepted: false, enforceAcceptance } as T;
      throw original;
    };
    let manual = false;
    let finish!: (status: TermsStatus) => void;
    const delivered = new Promise<TermsStatus>(resolve => { finish = resolve; });
    const wrapped = createTermsAwareApi(raw, { onRequired: () => { manual = true; }, onStatus: finish, onOtherError: () => {} });
    await assert.rejects(wrapped.request({ path: '/purchase' }), error => error === original);
    const status = await delivered;
    assert.equal(manual, true);
    assert.equal(status.isAccepted, false);
    assert.equal(status.acceptedVersion, null);
    assert.equal(requiresTermsAcceptance(status), enforceAcceptance);
    assert.deepEqual(calls, ['/purchase', '/api/v1/users/me/terms']);
  });
}

it('does not apply a terms-status response from a previous session', async () => {
  let finish!: (status: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const raw: AppApi = async <T>(request: { path: string }): Promise<T> => {
    if (request.path.endsWith('/terms')) return await pending as T;
    throw new ApiHttpError(403, 'termsAcceptanceRequired');
  };
  const statuses: TermsStatus[] = [];
  const wrapped = createTermsAwareApi(raw, { onRequired: () => {}, onStatus: status => statuses.push(status), onOtherError: () => {} });
  await assert.rejects(wrapped.request({ path: '/purchase' }));
  wrapped.invalidateSession();
  finish({ currentVersion: 'new', isAccepted: true, acceptedVersion: 'new', enforceAcceptance: true });
  await pending;
  await Promise.resolve();
  assert.deepEqual(statuses, []);
});

it('does not transform subscription restrictions into terms enforcement', async () => {
  const error = new ApiHttpError(403, 'subscriptionRequired');
  let required = false, handled = false;
  const raw: AppApi = async () => { throw error; };
  const wrapped = createTermsAwareApi(raw, { onRequired: () => { required = true; }, onStatus: () => assert.fail(), onOtherError: found => { assert.equal(found, error); handled = true; } });
  await assert.rejects(wrapped.request({ path: '/items' }), found => found === error);
  assert.equal(required, false); assert.equal(handled, true);
});
