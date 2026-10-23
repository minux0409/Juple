import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiHttpError, AuthExpiredError, type AppApi } from '../lib/appApi.ts';
import { receivedInvitations, respondToInvitation, RECEIVED_INVITATIONS_PATH } from '../lib/collectionInvitations.ts';
import { webDestinationOf, parseNotificationTarget } from '../lib/notifications.ts';
import { requiresSignIn } from '../lib/authSession.ts';

describe('received collection invitations (existing authenticated API)', () => {
  it('reads received requests and posts accept/decline to the same API as mobile', async () => {
    const calls: unknown[] = [];
    const invitations = [{ invitationId: 12, collectionName: 'Shared', ownerJupleId: 'Owner' }];
    const api: AppApi = async request => {
      calls.push(request);
      return (request.path === RECEIVED_INVITATIONS_PATH ? { items: invitations } : undefined) as never;
    };
    assert.deepEqual(await receivedInvitations(api), invitations);
    assert.equal(await respondToInvitation(api, 12, true), 'done');
    assert.equal(await respondToInvitation(api, 13, false), 'done');
    assert.deepEqual(calls, [
      { path: RECEIVED_INVITATIONS_PATH },
      { method: 'POST', path: '/api/v1/collection-invitations/12/accept' },
      { method: 'POST', path: '/api/v1/collection-invitations/13/decline' },
    ]);
  });
  it('handles a removed or already answered invitation without claiming success', async () => {
    for (const error of [new ApiHttpError(404, null), new ApiHttpError(409, 'invitationNotPending')]) {
      assert.equal(await respondToInvitation(async () => { throw error; }, 12, true), 'stale');
    }
  });
  it('does not swallow session loss, forbidden, rate-limit, or unrelated conflict errors', async () => {
    for (const error of [new AuthExpiredError(), new ApiHttpError(403, null), new ApiHttpError(429, 'rateLimited'), new ApiHttpError(409, 'accountNotReady')]) {
      await assert.rejects(respondToInvitation(async () => { throw error; }, 12, false), actual => actual === error);
    }
  });
  it('routes invitation notifications to the authenticated shared collections page', () => {
    const destination = webDestinationOf(parseNotificationTarget({ kind: 'collectionInvitations' }));
    assert.deepEqual(destination, { kind: 'href', href: '/collections?tab=shared&invitations=1' });
    assert.equal(requiresSignIn('/collections'), true);
    assert.equal(webDestinationOf(parseNotificationTarget({ kind: 'unavailable' })).kind, 'unavailable');
  });
});
