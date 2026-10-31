import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError, type AppApi } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  collectionDeletePath,
  collectionLeavePath,
  collectionLockIsConfigured,
  collectionManagementError,
  collectionRemoveLockPath,
  collectionSetLockPath,
} from '../lib/collectionManagement.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('signed-out entry and Agreement', () => {
  it('uses the focused login at /, keeps /welcome separate, and exposes legal links through a compact footer', () => {
    const layout = source('app/(app)/layout.tsx');
    const login = source('app/(app)/Landing.tsx');
    assert.doesNotMatch(layout, /JupleLanding|signedOutLanding/);
    assert.match(login, /signInLayout[\s\S]*signInBrandPanel[\s\S]*signInCard/);
    assert.match(login, /onClick=\{onSignIn\}/);
    for (const path of ['/privacy', '/terms', '/account-deletion']) assert.match(login, new RegExp(`href="${path}"`));
    assert.match(login, /businessFacts\.map/);
  });

  it('switches to one column for tablets and prevents a tall intro from pushing the CTA below short mobile screens', () => {
    const css = source('app/(app)/app.module.css');
    assert.match(css, /grid-template-columns:\s*minmax\(0, 1\.22fr\) minmax\(380px, 0\.9fr\)/);
    assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.signInLayout\s*\{[^}]*grid-template-columns:\s*1fr/);
    assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.signInFeatures\s*\{\s*display:\s*none/);
    assert.match(css, /@media \(max-height: 700px\) and \(max-width: 900px\)/);
  });

  it('uses the same brand lockup and surface treatment for the mandatory Agreement', () => {
    assert.match(source('app/(app)/TermsAgreement.tsx'), /agreementLockup[\s\S]*<BrandIcon size=\{38\}/);
    const css = source('app/(app)/app.module.css');
    assert.match(css, /\.agreementCard\s*\{[\s\S]*?border:[\s\S]*?border-radius:\s*22px[\s\S]*?background:/);
  });
});

describe('Collection owner management parity', () => {
  it('reuses the Mobile API contract for delete, member leave, lock and lock removal', () => {
    assert.equal(collectionDeletePath(7), '/api/v1/collections/7');
    assert.equal(collectionLeavePath(7), '/api/v1/collections/7/collaborators/me');
    assert.equal(collectionSetLockPath(7), '/api/v1/collections/7/lock');
    assert.equal(collectionRemoveLockPath(7), '/api/v1/collections/7/lock/remove');
  });

  it('checks the account-level lock password before enabling a new lock', async () => {
    const calls: unknown[] = [];
    const api: AppApi = async request => {
      calls.push(request);
      return { isConfigured: true, passwordChangedAtUtc: null } as never;
    };
    assert.equal(await collectionLockIsConfigured(api), true);
    assert.deepEqual(calls, [{ path: '/api/v1/users/me/collection-lock' }]);
  });

  it('maps lock failures by stable server code and keeps delete errors generic', () => {
    const dictionary = getAppDictionary('ko');
    assert.equal(collectionManagementError(new ApiHttpError(403, 'invalidCollectionPassword'), dictionary, 'remove'), dictionary.lockWrongPassword);
    assert.equal(collectionManagementError(new ApiHttpError(429, null), dictionary, 'remove'), dictionary.lockTooManyAttempts);
    assert.equal(collectionManagementError(new Error('network'), dictionary, 'delete'), dictionary.collectionDeleteError);
  });

  it('keeps lock/delete on the owner branch, adds Mobile member-leave, sends visit grants, and returns to Collections', () => {
    const detail = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
    const dialogs = source('app/(app)/collections/[collectionId]/CollectionManagementDialogs.tsx');
    assert.match(detail, /isSharedWithMe\(collection\)[\s\S]*: \[[\s\S]*key: 'lock'[\s\S]*key: 'delete'/);
    assert.match(detail, /key: 'leave'[\s\S]*setManagementMode\('leave'\)/);
    // A member of a shared Collection can report it; its Owner has nothing to report.
    assert.match(detail, /isSharedWithMe\(collection\)[\s\S]*key: 'report'[\s\S]*type: 'Collection'[\s\S]*key: 'leave'/);
    assert.match(dialogs, /collectionDeletePath\(collectionId\)[\s\S]*headers: unlockHeaders\(collectionId\)/);
    assert.match(dialogs, /collectionLeavePath\(collectionId\)[\s\S]*headers: unlockHeaders\(collectionId\)/);
    assert.match(detail, /router\.push\('\/collections'\);\s*router\.refresh\(\)/);
  });
});
