import { getStateFromPath } from '@react-navigation/native';

/** linking.ts reads the configured public host once at import, so each case loads it fresh with its own host. */
function loadLinking(host: string | undefined) {
  let linking!: typeof import('../linking').linking;
  jest.isolateModules(() => {
    jest.doMock('../../config/publicWebConfig', () => ({ publicWebConfig: { host } }));
    linking = require('../linking').linking;
  });
  return linking;
}

const stateOf = (path: string, linking: ReturnType<typeof loadLinking>) =>
  getStateFromPath(path, linking.config as Parameters<typeof getStateFromPath>[1]);

describe('canonical Collection share link routing', () => {
  it('only the configured https host is a deep-link prefix', () => {
    expect(loadLinking('dev.juple.co.kr').prefixes).toEqual(['https://dev.juple.co.kr']);
  });

  it('without a configured host nothing is routed (a safe no-op, never a guessed host)', () => {
    expect(loadLinking(undefined).prefixes).toEqual([]);
  });

  it('/c/{publicId} opens the shared Collection with exactly that share identifier', () => {
    const state = stateOf('/c/AbCdEfGh12345678', loadLinking('dev.juple.co.kr'));
    expect(state?.routes[0]).toMatchObject({ name: 'SharedCollection', params: { publicId: 'AbCdEfGh12345678' } });
  });

  it('a cold start and a warm start use the same path (the query string and a trailing slash change nothing)', () => {
    const linking = loadLinking('dev.juple.co.kr');
    for (const path of ['/c/AbCdEfGh12345678/', '/c/AbCdEfGh12345678?utm=x']) {
      expect(stateOf(path, linking)?.routes[0]).toMatchObject({ name: 'SharedCollection', params: { publicId: 'AbCdEfGh12345678' } });
    }
  });

  it('other paths are not a share link', () => {
    const linking = loadLinking('dev.juple.co.kr');
    for (const path of ['/', '/about', '/c', '/c/AbCdEfGh12345678/extra', '/collections/AbCdEfGh12345678']) {
      const route = stateOf(path, linking)?.routes[0];
      expect(route?.name).not.toBe('SharedCollection');
    }
  });

  it('the OAuth redirect scheme is never a deep-link prefix', () => {
    expect(loadLinking('dev.juple.co.kr').prefixes.some(prefix => prefix.includes('oauthredirect') || !prefix.startsWith('https://'))).toBe(false);
  });
});

describe('one share resolver for every entry source', () => {
  // The notification "<user>님이 '<Collection>' 컬렉션 링크를 보냈어요." and an external /c/{publicId} link (KakaoTalk, browser, cold or warm
  // start) must land on the SAME screen with the SAME parameters; SharedCollection then decides: member -> CollectionDetails,
  // public nonmember -> the public view, private nonmember -> the participation preview (see SharedCollectionMemberRouting.test).
  it('a Collection-link notification and the canonical link resolve to the identical route', () => {
    const { navigationActionFor, parseNotificationTarget } = require('../../notifications/notificationTarget');
    const publicId = 'AbCdEfGh12345678';
    const fromNotification = navigationActionFor(parseNotificationTarget({ kind: 'publicCollection', publicId }), 1);
    const fromLink = stateOf(`/c/${publicId}`, loadLinking('dev.juple.co.kr'))?.routes[0];

    expect({ name: fromNotification.name, params: fromNotification.params }).toEqual({ name: fromLink?.name, params: { publicId: (fromLink?.params as { publicId: string }).publicId } });
  });

  it('there is no second, notification-only route for share links', () => {
    const { navigationActionFor } = require('../../notifications/notificationTarget');
    expect(navigationActionFor({ kind: 'publicCollection', publicId: 'AbCdEfGh12345678' }, 1)?.name).toBe('SharedCollection');
  });
});

describe('internal pasted URL, external App Link and notification all feed the same resolver', () => {
  it('a canonical URL pasted into Juple yields the same publicId the App Link route carries - and then the same SharedCollection resolver', () => {
    const { parseCollectionShareUrl } = require('../../share/collectionShareUrl');
    const { navigationActionFor } = require('../../notifications/notificationTarget');
    const publicId = 'AbCdEfGh12345678';
    const url = `https://dev.juple.co.kr/c/${publicId}`;

    const pasted = parseCollectionShareUrl(url, 'dev.juple.co.kr');
    const appLink = stateOf(`/c/${publicId}`, loadLinking('dev.juple.co.kr'))?.routes[0];
    const notification = navigationActionFor({ kind: 'publicCollection', publicId }, 1);

    expect(pasted).toBe(publicId);
    expect(appLink).toMatchObject({ name: 'SharedCollection', params: { publicId } });
    expect(notification).toMatchObject({ name: 'SharedCollection', params: { publicId } });
  });

  it('every in-app entry point that accepts a URL sends a canonical Collection URL to SharedCollection instead of saving it as a link', () => {
    const read = (relative: string) => require('fs').readFileSync(require('path').resolve(__dirname, relative), 'utf8') as string;

    expect(read('../../screens/DailyInboxScreen.tsx')).toMatch(/parseCollectionShareUrl[\s\S]*navigate\('SharedCollection'/);
    expect(read('../../screens/NewLinkReviewScreen.tsx')).toMatch(/parseCollectionShareUrl[\s\S]*replace\('SharedCollection'/);
    expect(read('../../share/IncomingShareRouter.tsx')).toMatch(/parseCollectionShareUrl[\s\S]*navigate\('SharedCollection'/);
    expect(read('../../share/incomingShareHeadlessTask.ts')).toMatch(/parseCollectionShareUrl/);
  });
});
