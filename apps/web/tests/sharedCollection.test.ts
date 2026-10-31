import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { requiresSignIn } from '../lib/authSession.ts';
import {
  classifyCollectionShareUrl,
  collectionShareDestination,
  OFFICIAL_SHARE_HOSTS,
  publicIdFromServerVerifiedShareUrl,
  refusedShareUrlDestination,
  sharedCollectionHref,
} from '../lib/collectionShareUrl.ts';
import {
  decideShareEntry,
  hasVisibleProfile,
  isPublicShare,
  joinRequestPath,
  joinResultDestination,
  membershipPath,
  saveSharedCollectionPath,
  shareEntryTileKey,
  shareJoinErrorKey,
  type ShareProfile,
} from '../lib/sharedCollectionEntry.ts';
import { readWebAppConfig } from '../lib/webAppConfig.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DEV = 'dev.juple.co.kr';
const PROD = 'juple.co.kr';
const ID = 'AbCdEfGh12345678';

const nonMember = { isMember: false, collectionId: null, role: null } as const;
const publicProfile: ShareProfile = { name: '여행', isLocked: false, isPublic: true, icon: 'Travel', color: 'blue', iconImageUrl: null };
const privateProfile: ShareProfile = { ...publicProfile, isPublic: false };

describe('Juple Collection share URLs: every official environment, each decided by its own environment', () => {
  /** Where a pasted link goes from an app serving `currentHost` (null = this app's host is not configured). */
  const route = (value: string, currentHost: string | null) => {
    const link = classifyCollectionShareUrl(value, currentHost);
    return link ? collectionShareDestination(link) : 'newLinkReview';
  };

  it('both official hosts are recognized everywhere, exact matches only; query, fragment, a trailing slash and :443 allowed', () => {
    assert.deepEqual([...OFFICIAL_SHARE_HOSTS].sort(), ['dev.juple.co.kr', 'juple.co.kr']);
    for (const current of [DEV, PROD, null]) {
      assert.equal(classifyCollectionShareUrl(`https://${DEV}/c/${ID}`, current)?.publicId, ID, `dev link on ${current}`);
      assert.equal(classifyCollectionShareUrl(`https://${PROD}/c/${ID}`, current)?.publicId, ID, `prod link on ${current}`);
    }
    const link = classifyCollectionShareUrl(`  https://DEV.Juple.co.kr:443/c/${ID}/?utm_source=kakao#x  `, DEV);
    assert.deepEqual(link, { publicId: ID, host: DEV, canonicalUrl: `https://${DEV}/c/${ID}`, sameEnvironment: true });
  });

  it('look-alikes and anything else are ordinary links', () => {
    for (const value of [
      `https://${PROD}.evil.com/c/${ID}`,
      `https://${DEV}.attacker.com/c/${ID}`,
      `https://fakejuple.co.kr/c/${ID}`,
      `https://www.${PROD}.evil.com/c/${ID}`,
      `https://evil.com/${DEV}/c/${ID}`,
      `http://${DEV}/c/${ID}`,
      `http://${PROD}/c/${ID}`,
      `https://user:pass@${PROD}/c/${ID}`,
      `https://${DEV}:8443/c/${ID}`,
      `https://${PROD}/c`,
      `https://${PROD}/c/${ID}/items`,
      `https://${PROD}/about`,
      `https://${PROD}/c/short`,
      `https://${PROD}/c/${ID} extra`,
      'not a url',
    ]) {
      for (const current of [DEV, PROD, null]) {
        assert.equal(classifyCollectionShareUrl(value, current), null, `${value} on ${current}`);
      }
    }
  });

  it('DEV Web: a DEV link opens here (/shared); a Production link goes to Production - never the review', () => {
    assert.deepEqual(route(`https://${DEV}/c/${ID}`, DEV), { kind: 'inApp', href: `/shared/${ID}` });
    assert.deepEqual(route(`https://${PROD}/c/${ID}?utm=1`, DEV), { kind: 'otherEnvironment', url: `https://${PROD}/shared/${ID}` });
  });

  it('Production Web: a Production link opens here; a DEV link goes to DEV - never the review', () => {
    assert.deepEqual(route(`https://${PROD}/c/${ID}`, PROD), { kind: 'inApp', href: `/shared/${ID}` });
    assert.deepEqual(route(`https://${DEV}/c/${ID}`, PROD), { kind: 'otherEnvironment', url: `https://${DEV}/shared/${ID}` });
  });

  it('an app without its own host configured still never reviews a Juple link: every one goes to its environment', () => {
    assert.deepEqual(route(`https://${DEV}/c/${ID}`, null), { kind: 'otherEnvironment', url: `https://${DEV}/shared/${ID}` });
    assert.deepEqual(route(`https://${PROD}/c/${ID}`, null), { kind: 'otherEnvironment', url: `https://${PROD}/shared/${ID}` });
  });

  it('ordinary links (YouTube, Instagram, any site) still go to 새 링크 검토, in every environment', () => {
    for (const current of [DEV, PROD, null]) {
      for (const value of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.instagram.com/p/DPabcdefGHI/', 'https://example.com/c/AbCdEfGh12345678']) {
        assert.equal(route(value, current), 'newLinkReview', `${value} on ${current}`);
      }
    }
  });

  it('a save the server refused (an older path) follows the same rule; its own unrecognized link opens here; never a saved link', () => {
    assert.deepEqual(refusedShareUrlDestination(`https://${PROD}/c/${ID}`, DEV), { kind: 'otherEnvironment', url: `https://${PROD}/shared/${ID}` });
    assert.deepEqual(refusedShareUrlDestination(`https://${DEV}/c/${ID}`, DEV), { kind: 'inApp', href: `/shared/${ID}` });
    assert.deepEqual(refusedShareUrlDestination(`https://staging.example/c/${ID}`, DEV), { kind: 'inApp', href: `/shared/${ID}` }, 'the server knows its own host');
    assert.equal(refusedShareUrlDestination('https://example.com/whatever', DEV), null);
    assert.equal(publicIdFromServerVerifiedShareUrl(`https://anything.example/c/${ID}`), ID);
    assert.equal(sharedCollectionHref(ID), `/shared/${ID}`);
  });

  it('JUPLE_PUBLIC_WEB_HOST is the CURRENT environment only (optional, a bare host) - not the list of hosts recognized', () => {
    const base = {
      JUPLE_ENTRA_AUTHORITY: 'https://jupledev.ciamlogin.com',
      JUPLE_ENTRA_TENANT_ID: 't',
      JUPLE_ENTRA_WEB_CLIENT_ID: 'c',
      JUPLE_ENTRA_API_SCOPE: 's',
      JUPLE_WEB_BASE_URL: 'http://localhost:3000',
    };
    const host = (value: string | undefined) => {
      const result = readWebAppConfig({ ...base, JUPLE_PUBLIC_WEB_HOST: value });
      return result.ok ? result.config.publicWebHost : 'not ok';
    };
    assert.equal(host(undefined), null);
    assert.equal(host('dev.juple.co.kr'), 'dev.juple.co.kr');
    for (const bad of ['https://dev.juple.co.kr', 'dev.juple.co.kr/c', 'dev.juple.co.kr:443', 'localhost']) {
      assert.equal(host(bad), null, bad);
    }
  });
});

describe('what the link is for me (the mobile SharedCollectionScreen decisions)', () => {
  it('1-2. my own Collection / one I belong to: straight to that Collection, no question', () => {
    for (const role of ['owner', 'contributor', 'submitter', 'viewer'] as const) {
      assert.deepEqual(decideShareEntry({ isMember: true, collectionId: 42, role }, publicProfile), { kind: 'member', collectionId: 42 });
    }
    assert.deepEqual(decideShareEntry({ isMember: true, collectionId: 42, role: 'owner' }, 'unavailable'), { kind: 'member', collectionId: 42 }, 'a member never waits for the profile');
  });

  it('3. public + not a member: 컬렉션 추가; 4. private + not a member: 참가 요청; 5. a waiting request: 승인 대기 중', () => {
    assert.deepEqual(decideShareEntry(nonMember, publicProfile), { kind: 'publicAdd', profile: publicProfile });
    assert.deepEqual(decideShareEntry(nonMember, { ...publicProfile, isPublic: undefined }), { kind: 'publicAdd', profile: { ...publicProfile, isPublic: undefined } }, 'absent flag = public');
    assert.deepEqual(decideShareEntry(nonMember, privateProfile), { kind: 'privateRequest', profile: privateProfile });
    assert.deepEqual(decideShareEntry({ ...nonMember, joinRequestPending: true }, privateProfile), { kind: 'pending', profile: privateProfile });
    assert.deepEqual(decideShareEntry(null, privateProfile), { kind: 'privateRequest', profile: privateProfile }, 'a failed membership lookup: the link decides');
  });

  it('6. unknown / revoked / unreadable: one unavailable state; a protected link: its password first, nothing shown', () => {
    assert.deepEqual(decideShareEntry(null, 'unavailable'), { kind: 'unavailable' });
    assert.deepEqual(decideShareEntry(nonMember, 'unavailable'), { kind: 'unavailable' });
    assert.deepEqual(decideShareEntry(nonMember, { name: null, isLocked: true }), { kind: 'locked' });
    assert.deepEqual(decideShareEntry(nonMember, { name: null, isLocked: false }), { kind: 'unavailable' });
  });

  it('after 저장 / 요청: a member now opens the Collection; otherwise the request waits', () => {
    assert.deepEqual(joinResultDestination({ outcome: 'joined', collectionId: 7 }), { kind: 'open', collectionId: 7 });
    assert.deepEqual(joinResultDestination({ outcome: 'alreadyMember', collectionId: 7 }), { kind: 'open', collectionId: 7 });
    assert.deepEqual(joinResultDestination({ outcome: 'requested', collectionId: null }), { kind: 'pending' });
    assert.deepEqual(joinResultDestination({ outcome: 'alreadyRequested', collectionId: null }), { kind: 'pending' }, 'a second request changes nothing');
  });

  it('errors are the mobile messages', () => {
    assert.equal(shareJoinErrorKey(new ApiHttpError(409, 'joinNotAllowed')), 'joinNotAllowed');
    assert.equal(shareJoinErrorKey(new ApiHttpError(403, 'collectionLocked')), 'joinLocked');
    assert.equal(shareJoinErrorKey(new ApiHttpError(404, null)), 'unavailable');
    assert.equal(shareJoinErrorKey(new ApiHttpError(429, null)), 'tooManyRequests');
    assert.equal(shareJoinErrorKey(new Error('offline')), 'joinFailed');
    const ko = getAppDictionary('ko');
    assert.equal(ko.shareEntryAddTitle, '컬렉션 추가');
    assert.equal(ko.shareEntryRequestTitle, '참가 요청');
    assert.equal(ko.shareEntryPendingTitle, '승인 대기 중');
  });

  it('the same API as mobile: membership, 저장 (POST save), 요청 (POST join-requests)', () => {
    assert.equal(membershipPath(ID), `/api/v1/public-shares/${ID}/membership`);
    assert.equal(saveSharedCollectionPath(ID), `/api/v1/public-shares/${ID}/save`);
    assert.equal(joinRequestPath(ID), `/api/v1/public-shares/${ID}/join-requests`);
    assert.ok(shareEntryTileKey(ID) < 0 && shareEntryTileKey(ID) === shareEntryTileKey(ID));
  });

  it('the /c share page shares the two link facts (public, profile visible) - no second copy of the rule', () => {
    assert.equal(isPublicShare({ isPublic: false }), false);
    assert.equal(isPublicShare({}), true);
    assert.equal(hasVisibleProfile({ name: null }), false);
    const shareView = read('lib/shareView.ts');
    assert.match(shareView, /if \(!hasVisibleProfile\(collection\)\) \{\s*return \{ kind: 'locked' \};/);
    assert.match(shareView, /if \(!isPublicShare\(collection\)\) \{/);
    assert.doesNotMatch(shareView, /isPublic === false|collection\.name === null/);
  });
});

describe('the screen and the entry points', () => {
  const entry = read('app/(app)/shared/[publicId]/SharedCollectionEntry.tsx');
  const actions = read('app/(app)/shared/[publicId]/actions.ts');

  it('a member is replaced by the Collection; 저장 / 요청 only on the explicit button, with the visit grant; 승인 대기 중 offers no second request', () => {
    assert.match(entry, /if \(entry\?\.kind === 'member'\) \{\s*router\.replace\(collectionHref\(entry\.collectionId\)\);/);
    assert.match(entry, /run\(entry\.kind === 'publicAdd' \? saveSharedCollectionPath\(publicId\) : joinRequestPath\(publicId\)\)/);
    assert.match(entry, /headers: unlockToken \? \{ \[COLLECTION_UNLOCK_HEADER\]: unlockToken \} : undefined/);
    assert.match(entry, /if \(entry\.kind === 'pending'\) return <PendingJoinDialog/);
    assert.match(entry, /if \(busyRef\.current\) \{\s*return;/, 'never twice at once');
    assert.doesNotMatch(entry, /useEffect\([^)]*run\(/, 'never automatic');
  });

  it('the anonymous Public API is reached server-side (its CORS only allows the share host); only profile fields pass through', () => {
    assert.match(actions, /^'use server';/);
    assert.match(actions, /getPublicCollection\(apiBaseUrl\(\), publicId,/);
    assert.match(actions, /name: typeof collection\.name === 'string' \? collection\.name : null,[\s\S]*iconImageUrl:/);
    assert.match(actions, /const ATTEMPT_COOKIE_PATH = '\/shared';/);
    assert.doesNotMatch(entry, /lib\/publicApi/);
    assert.doesNotMatch(actions, /console\./, 'nothing (least of all the password) is logged');
  });

  it('Home: normalize, then ANY Juple share link leaves BEFORE the review (here: /shared; another environment: its own address); every other link goes to 링크 저장 (/save) by a client navigation', () => {
    const home = read('app/(app)/HomeView.tsx');
    const detect = home.indexOf('classifyCollectionShareUrl(url, publicWebHost)');
    const inApp = home.indexOf('router.push(destination.href)');
    const other = home.indexOf('window.location.assign(destination.url)');
    const review = home.indexOf('openReview(url, href => router.push(href));');
    assert.ok(home.indexOf('normalizeEnteredUrl(value)') < detect && detect < inApp && inApp < other && other < review);
    assert.match(home, /if \(shareLink\) \{[\s\S]*?return;\s*\}\s*\/\/ A soft navigation/, 'a share link never reaches openReview');
  });

  it('11. /items/new with a share link of either environment: straight to its destination - no metadata resolve, no picker, no save; the save refusal follows the same rule', () => {
    const review = read('app/(app)/items/new/NewLinkReviewView.tsx');
    assert.match(review, /const shareLink = classifyCollectionShareUrl\(url, publicWebHost\);\s*const shareTarget = shareLink \? collectionShareDestination\(shareLink\) : null;/);
    assert.match(review, /if \(shareTargetKind === 'inApp' && shareTargetAddress\) \{\s*router\.replace\(shareTargetAddress\);\s*\} else if \(shareTargetKind === 'otherEnvironment' && shareTargetAddress\) \{\s*window\.location\.replace\(shareTargetAddress\);/);
    assert.match(review, /if \(!valid \|\| shareTargetKind\) \{\s*return undefined;/, 'nothing resolved, no destinations loaded');
    assert.match(review, /if \(shareTargetKind\) \{\s*return null;/, 'nothing offered to save');
    assert.match(review, /const destination = refusedShareUrlDestination\(url, publicWebHost\);\s*if \(destination\) \{\s*leaveFor\(destination\);/);
    assert.doesNotMatch(review, /router\.replace\(`\/c\//);
    // neither destination ever sends anyone back to the review (no loop)
    assert.doesNotMatch(entry, /items\/new|openReview/);
  });

  it('another environment is never asked with this one\'s sign-in: the hand-off is a plain navigation to its own address', () => {
    for (const file of ['app/(app)/HomeView.tsx', 'app/(app)/items/new/NewLinkReviewView.tsx', 'app/(app)/shared/[publicId]/SharedCollectionEntry.tsx', 'app/(app)/shared/[publicId]/actions.ts']) {
      assert.doesNotMatch(read(file), /https:\/\/(dev\.)?juple\.co\.kr|OFFICIAL_SHARE_HOSTS/, file);
    }
    // the in-app flow only ever talks to this environment's API (relative /api/v1 paths through the signed-in client)
    assert.match(entry, /api<ShareMembership>\(\{ path: membershipPath\(publicId\) \}\)/);
  });

  it('/shared/{publicId} is a signed-in page; the anonymous /c page stays public', () => {
    assert.equal(requiresSignIn(`/shared/${ID}`), true);
    assert.equal(requiresSignIn(`/c/${ID}`), false);
  });
});

describe('/c is the anonymous landing, /shared the signed-in entry - a link pasted inside Juple always goes to a /shared', () => {
  it('every destination of a pasted Juple link is a /shared entry (here or on its own environment), never a /c page', () => {
    for (const current of [DEV, PROD, null]) {
      for (const host of [DEV, PROD]) {
        const link = classifyCollectionShareUrl(`https://${host}/c/${ID}?x=1`, current);
        const destination = collectionShareDestination(link!);
        const address = destination.kind === 'inApp' ? destination.href : destination.url;
        assert.match(address, new RegExp(`/shared/${ID}$`), `${host} link on ${current}`);
        assert.doesNotMatch(address, /\/c\//, `${host} link on ${current}`);
        if (destination.kind === 'otherEnvironment') {
          assert.equal(destination.url, `https://${host}/shared/${ID}`, 'that environment\'s own /shared, over https');
        }
      }
    }
  });

  it('signed out on /shared: the existing Web sign-in, then back to exactly the same /shared/{publicId}', () => {
    assert.equal(requiresSignIn(`/shared/${ID}`), true);
    const root = read('app/(app)/AppRoot.tsx');
    assert.match(root, /msal\.loginRedirect\(\{ scopes: apiScopes\(config\), redirectStartPage: window\.location\.href \}\)/);
    // the membership is asked only once signed in - by the /shared page itself, with this environment's session
    assert.match(read('app/(app)/shared/[publicId]/SharedCollectionEntry.tsx'), /api<ShareMembership>\(\{ path: membershipPath\(publicId\) \}\)/);
  });

  it('the anonymous /c page is unchanged: it never asks for membership or signs anyone in', () => {
    const page = read('app/c/[publicId]/page.tsx');
    // Its one way into the signed-in app is the plain link to report: following it is what asks for a sign-in.
    assert.doesNotMatch(page, /membership|msal|loginRedirect/);
  });
});
