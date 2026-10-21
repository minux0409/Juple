import { getStateFromPath } from '@react-navigation/native';

// Node's own fs, read synchronously - this app ships no Node type definitions, so only the one function used is typed here.
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
declare const __dirname: string;

const android = `${__dirname}/../../../android/app`;
const manifest = readFileSync(`${android}/src/main/AndroidManifest.xml`, 'utf8');

/** The MainActivity element, and its intent-filters in file order. */
function mainActivityFilters(): string[] {
  const start = manifest.indexOf('android:name=".MainActivity"');
  const end = manifest.indexOf('</activity>', start);
  const block = manifest.slice(manifest.lastIndexOf('<activity', start), end);
  return block.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? [];
}

const names = (filter: string, tag: 'action' | 'category') =>
  [...filter.matchAll(new RegExp(`<${tag} android:name="([^"]+)"`, 'g'))].map(match => match[1]);
const dataTags = (filter: string) => filter.match(/<data[\s\S]*?\/>/g) ?? [];

describe('MainActivity intent filters (the app\'s own App Links)', () => {
  const filters = mainActivityFilters();

  it('has exactly three independent filters: launcher, /c/ share links, /open-app', () => {
    expect(filters).toHaveLength(3);
  });

  it('the launcher filter is untouched: MAIN + LAUNCHER only (no BROWSABLE, no data)', () => {
    const [launcher] = filters;
    expect(names(launcher, 'action')).toEqual(['android.intent.action.MAIN']);
    expect(names(launcher, 'category')).toEqual(['android.intent.category.LAUNCHER']);
    expect(dataTags(launcher)).toHaveLength(0);
    expect(launcher).not.toMatch(/autoVerify/);
  });

  it('the Collection share filter is unchanged: verified https /c/ prefix on the public host', () => {
    const share = filters[1];
    expect(share).toMatch(/android:autoVerify="true"/);
    expect(names(share, 'action')).toEqual(['android.intent.action.VIEW']);
    expect(names(share, 'category')).toEqual(['android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE']);
    const data = dataTags(share);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatch(/android:scheme="https"/);
    expect(data[0]).toMatch(/android:host="\$\{appLinksHost\}"/);
    expect(data[0]).toMatch(/android:pathPrefix="\/c\/"/);
  });

  it('/open-app is its own verified filter: VIEW + DEFAULT + BROWSABLE, https, the public host, exactly the path /open-app', () => {
    const open = filters[2];
    expect(open).toMatch(/android:autoVerify="true"/);
    expect(names(open, 'action')).toEqual(['android.intent.action.VIEW']);
    expect(names(open, 'category')).toEqual(['android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE']);
    const data = dataTags(open);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatch(/android:scheme="https"/);
    expect(data[0]).toMatch(/android:host="\$\{appLinksHost\}"/);
    expect(data[0]).toMatch(/android:path="\/open-app"/);
    // Exact path only: not a prefix / pattern, and never the whole site.
    expect(data[0]).not.toMatch(/pathPrefix|pathPattern|pathAdvancedPattern|pathSuffix/);
    expect(data[0]).not.toMatch(/android:path="\/?"/);
  });

  it('no custom scheme anywhere on MainActivity (https only), and the two App Link filters are never merged', () => {
    const all = filters.flatMap(dataTags);
    for (const tag of all) {
      expect(tag).toMatch(/android:scheme="https"/);
    }
    expect(all).toHaveLength(2);
    expect(manifest).not.toMatch(/android:scheme="juple"/);
  });

  it('the share-target and other activities are not touched by this', () => {
    expect(manifest).toMatch(/android:name="android\.intent\.action\.SEND"/);
    expect((manifest.match(/android:autoVerify="true"/g) ?? []).length).toBe(2);
  });
});

describe('/open-app is launch only', () => {
  it('the build is newer than the released 30 and the display version stays 1.0', () => {
    const gradle = readFileSync(`${android}/build.gradle`, 'utf8');
    const build = Number(gradle.match(/versionCode (\d+)\b/)?.[1]);
    expect(build).toBeGreaterThan(30);
    expect(gradle).toMatch(/versionName "1\.0"/);
  });

  function loadLinking(host: string | undefined) {
    let linking!: typeof import('../linking');
    jest.isolateModules(() => {
      jest.doMock('../../config/publicWebConfig', () => ({ publicWebConfig: { host } }));
      linking = require('../linking');
    });
    return linking;
  }

  it('is recognised exactly (any query / hash / trailing slash), and nothing else is', () => {
    const { isLaunchOnlyUrl } = loadLinking('juple.co.kr');
    for (const url of ['https://juple.co.kr/open-app', 'https://juple.co.kr/open-app/', 'https://juple.co.kr/open-app?x=1', 'https://juple.co.kr/open-app#a']) {
      expect(isLaunchOnlyUrl(url)).toBe(true);
    }
    for (const url of ['https://juple.co.kr/', 'https://juple.co.kr/c/AbCdEfGh12345678', 'https://juple.co.kr/open-app-now', 'https://juple.co.kr/open-app/x', 'https://juple.co.kr/x/open-app', 'juple://open-app', '']) {
      expect(isLaunchOnlyUrl(url)).toBe(false);
    }
  });

  it('React Navigation ignores it on a cold and on a warm start (no screen, no reset, no unknown-link handling) but still routes /c/ links', () => {
    const { linking } = loadLinking('juple.co.kr');
    expect(linking.filter?.('https://juple.co.kr/open-app')).toBe(false);
    expect(linking.filter?.('https://juple.co.kr/c/AbCdEfGh12345678')).toBe(true);
    // Not a route either: even without the filter there is no state for it.
    expect(getStateFromPath('/open-app', linking.config as Parameters<typeof getStateFromPath>[1])).toBeUndefined();
    const share = getStateFromPath('/c/AbCdEfGh12345678', linking.config as Parameters<typeof getStateFromPath>[1]);
    expect(share?.routes[0]).toMatchObject({ name: 'SharedCollection', params: { publicId: 'AbCdEfGh12345678' } });
  });
});
